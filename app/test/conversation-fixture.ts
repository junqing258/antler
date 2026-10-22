import type { ThreadMessageLike } from "@assistant-ui/react";
import { vi } from "vitest";
const rows = new Map<string, any>();
export function installConversationFixture(model = "test-model") {
  rows.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/conversations/changes")
        return new Response(new ReadableStream({ start() {} }));
      if (url.pathname === "/api/conversations")
        return new Response(
          JSON.stringify({
            conversations: [...rows.values()].filter(
              (row) =>
                !url.searchParams.get("agentId") ||
                row.agentId === url.searchParams.get("agentId"),
            ),
            nextCursor: null,
            lastChangeId: 0,
          }),
        );
      if (url.pathname.startsWith("/api/conversations/")) {
        const id = decodeURIComponent(url.pathname.split("/")[3]);
        const row = rows.get(id);
        if (!row) return new Response("{}", { status: 404 });
        if (url.pathname.endsWith("/messages"))
          return new Response(
            JSON.stringify({
              messages: row.messages,
              revision: row.revision,
              activeRunId: null,
              hasMore: false,
            }),
          );
        if (init?.method === "PATCH") {
          row.title = JSON.parse(String(init.body)).title;
          row.titleSource = "manual";
          row.revision++;
        }
        if (init?.method === "DELETE") rows.delete(id);
        const { messages: _messages, ...summary } = row;
        return new Response(JSON.stringify(summary));
      }
      return new Response(JSON.stringify({ model }));
    }),
  );
}
export async function saveConversationMessages(
  id: string,
  messages: ThreadMessageLike[],
  agentId?: string,
) {
  const current = rows.get(id);
  const now = new Date().toISOString();
  if (!current && !messages.length) return undefined;
  const title =
    typeof messages[0]?.content === "string" ? messages[0].content : "新会话";
  rows.set(id, {
    id,
    agentId: current ? current.agentId : agentId,
    title: current?.title ?? title,
    titleSource: current?.titleSource ?? "fallback",
    revision: (current?.revision ?? 0) + 1,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    messages: messages.map((message, i) => ({
      id: `${id}-${i}`,
      seq: i + 1,
      role: message.role,
      status: "complete",
      createdAt: now,
      runId: id,
      appliedEventId: 0,
      content: {
        schemaVersion: 1,
        parts:
          typeof message.content === "string"
            ? [{ type: "text", text: message.content }]
            : message.content,
      },
    })),
  });
}
