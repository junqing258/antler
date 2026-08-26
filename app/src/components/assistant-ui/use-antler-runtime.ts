import {
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
  useLocalRuntime,
} from "@assistant-ui/react";
import type { ProviderConfig } from "@/lib/provider-config";

type ServerInfo = { baseUrl: string; token: string };
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

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
  getProviderConfig: () => ProviderConfig,
) {
  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal }) {
      const message = getText(messages.at(-1)!);
      if (!message.trim()) return;
      let cancel: (() => void) | undefined;
      const content: ThreadAssistantMessagePart[] = [];
      try {
        const server = await getServerInfo();
        const headers = {
          "content-type": "application/json",
          "x-antler-token": server.token,
        };
        const provider = getProviderConfig();
        const created = await fetch(`${server.baseUrl}/api/runs`, {
          method: "POST",
          headers,
          // The key is read from browser localStorage and used only for this
          // local request. The server never persists provider configuration.
          body: JSON.stringify({
            message,
            conversationId,
            // Keep the existing environment-variable setup usable until the
            // user has saved a local provider key.
            ...(provider.apiKey.trim()
              ? { provider }
              : {}),
          }),
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
        let textPartIndex: number | undefined;
        let reasoningPartIndex: number | undefined;

        const snapshot = () => ({ content: [...content] });
        const appendText = (delta: string) => {
          const current =
            textPartIndex === undefined ? undefined : content[textPartIndex];
          if (textPartIndex !== undefined && current?.type === "text") {
            content[textPartIndex] = { ...current, text: current.text + delta };
          } else {
            textPartIndex = content.push({ type: "text", text: delta }) - 1;
          }
        };
        const appendReasoning = (delta: string) => {
          const current =
            reasoningPartIndex === undefined
              ? undefined
              : content[reasoningPartIndex];
          if (
            reasoningPartIndex !== undefined &&
            current?.type === "reasoning"
          ) {
            content[reasoningPartIndex] = {
              ...current,
              text: current.text + delta,
            };
          } else {
            reasoningPartIndex =
              content.push({ type: "reasoning", text: delta }) - 1;
          }
        };
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
              stepId?: string;
              kind?: string;
              tool?: string;
              args?: JsonObject;
              result?: unknown;
              summary?: string;
              isError?: boolean;
              error?: { message?: string };
            };
            if (event === "run.failed") {
              throw new Error(payload.error?.message ?? "任务执行失败");
            }
            if (event === "run.cancelled") return;
            if (event === "assistant.delta" && payload.delta) {
              appendText(payload.delta);
              reasoningPartIndex = undefined;
              yield snapshot();
              continue;
            }
            if (event === "assistant.thinking.delta" && payload.delta) {
              appendReasoning(payload.delta);
              textPartIndex = undefined;
              yield snapshot();
              continue;
            }
            if (
              event === "step.started" &&
              payload.kind === "tool" &&
              payload.stepId &&
              payload.tool
            ) {
              content.push({
                type: "tool-call",
                toolCallId: payload.stepId,
                toolName: payload.tool,
                args: payload.args ?? {},
                argsText: JSON.stringify(payload.args ?? {}),
              });
              textPartIndex = undefined;
              reasoningPartIndex = undefined;
              yield snapshot();
              continue;
            }
            if (event === "tool.completed" && payload.stepId) {
              const index = content.findIndex(
                (part) =>
                  part.type === "tool-call" &&
                  part.toolCallId === payload.stepId,
              );
              const current = index === -1 ? undefined : content[index];
              if (current?.type === "tool-call") {
                content[index] = {
                  ...current,
                  result: payload.result ?? { summary: payload.summary },
                  isError: payload.isError,
                };
                yield snapshot();
              }
            }
          }
        }
      } catch (error) {
        if (!abortSignal.aborted) {
          const detail = error instanceof Error ? error.message : "未知错误";
          yield {
            content: [
              ...content,
              { type: "text" as const, text: `请求失败：${detail}` },
            ],
          };
        }
      } finally {
        if (cancel) abortSignal.removeEventListener("abort", cancel);
      }
    },
  };
  return useLocalRuntime(adapter);
}
