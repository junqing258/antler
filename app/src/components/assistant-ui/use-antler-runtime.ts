import { type ChatModelAdapter, useLocalRuntime } from "@assistant-ui/react";

type ServerInfo = { baseUrl: string; token: string };

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

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

export function useAntlerRuntime(
  getServerInfo: () => Promise<ServerInfo>,
  conversationId: string,
) {
  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal }) {
      const message = getText(messages.at(-1)!);
      if (!message.trim()) return;
      let cancel: (() => void) | undefined;
      try {
        const server = await getServerInfo();
        const headers = {
          "content-type": "application/json",
          "x-antler-token": server.token,
        };
        const created = await fetch(`${server.baseUrl}/api/runs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message, conversationId }),
          signal: abortSignal,
        });
        if (!created.ok) {
          throw new Error(await responseError(created, "任务创建失败"));
        }
        const { eventsUrl, runId } = (await created.json()) as {
          eventsUrl: string;
          runId: string;
        };
        cancel = () => {
          void fetch(`${server.baseUrl}/api/runs/${runId}/cancel`, { method: "POST", headers });
        };
        abortSignal.addEventListener("abort", cancel, { once: true });
        const events = await fetch(
          `${server.baseUrl}${eventsUrl}?token=${encodeURIComponent(server.token)}`,
          { headers: { "x-antler-token": server.token }, signal: abortSignal },
        );
        if (!events.ok || !events.body) {
          throw new Error(await responseError(events, "无法连接任务输出流"));
        }

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
            if (!data) continue;
            const payload = JSON.parse(data) as {
              delta?: string;
              error?: { message?: string };
            };
            if (event === "run.failed") {
              throw new Error(payload.error?.message ?? "任务执行失败");
            }
            if (event === "run.cancelled") return;
            if (event !== "assistant.delta" || !payload.delta) continue;
            text += payload.delta;
            yield { content: [{ type: "text" as const, text }] };
          }
        }
      } catch (error) {
        if (!abortSignal.aborted) {
          const detail = error instanceof Error ? error.message : "未知错误";
          yield { content: [{ type: "text" as const, text: `请求失败：${detail}` }] };
        }
      } finally {
        if (cancel) abortSignal.removeEventListener("abort", cancel);
      }
    },
  };
  return useLocalRuntime(adapter);
}
