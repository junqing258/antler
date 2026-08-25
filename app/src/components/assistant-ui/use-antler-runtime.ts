import { type ChatModelAdapter, useLocalRuntime } from "@assistant-ui/react";

type ServerInfo = { baseUrl: string; token: string };

function getText(
  message: Parameters<ChatModelAdapter["run"]>[0]["messages"][number],
) {
  return message.content
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

export function useAntlerRuntime(getServerInfo: () => Promise<ServerInfo>) {
  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal }) {
      const message = getText(messages.at(-1)!);
      if (!message.trim()) return;
      const server = await getServerInfo();
      const headers = {
        "content-type": "application/json",
        "x-antler-token": server.token,
      };
      const created = await fetch(`${server.baseUrl}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message }),
        signal: abortSignal,
      });
      if (!created.ok) throw new Error("任务创建失败");
      const { eventsUrl } = (await created.json()) as { eventsUrl: string };
      const events = await fetch(
        `${server.baseUrl}${eventsUrl}?token=${encodeURIComponent(server.token)}`,
        { headers: { "x-antler-token": server.token }, signal: abortSignal },
      );
      if (!events.ok || !events.body) throw new Error("无法连接任务输出流");

      const reader = events.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (event !== "message.delta" || !data) continue;
          const payload = JSON.parse(data) as { delta?: string };
          if (!payload.delta) continue;
          text += payload.delta;
          yield { content: [{ type: "text" as const, text }] };
        }
      }
    },
  };
  return useLocalRuntime(adapter);
}
