import { expect, it, vi } from "vitest";
import type { ClientPlatform } from "@antler/platform";
import { createHttpSessionDependencies } from "../src";

it("maps server snapshots and submits with the host's authenticated connection", async () => {
  const request = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/conversations?limit=50"))
      return Response.json({ lastChangeId: 7 });
    if (url.endsWith("/messages?limit=50"))
      return Response.json({
        revision: 3,
        activeRunId: "run",
        hasMore: true,
        messages: [
          {
            id: "m",
            role: "assistant",
            seq: 8,
            runId: "run",
            appliedEventId: 2,
            status: "running",
            createdAt: "2026-01-01T00:00:00Z",
            content: {
              schemaVersion: 1,
              parts: [{ type: "text", text: "reply" }],
            },
          },
        ],
      });
    if (url.endsWith("/api/conversations/thread"))
      return Response.json({
        executionConfig: { credentialSource: "server" },
        contextState: "available",
      });
    if (url.endsWith("/api/runs") && init.method === "POST")
      return Response.json({ runId: "new-run" }, { status: 202 });
    return new Response("", { status: 404 });
  });
  const platform: ClientPlatform = {
    initialize: vi.fn().mockResolvedValue(undefined),
    connection: async () => ({
      baseUrl: "https://backend",
      headers: { authorization: "Bearer token" },
    }),
    request,
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: () => () => {},
    createId: () => "id",
    onForeground: () => () => {},
  };
  const deps = createHttpSessionDependencies(
    platform,
    () => ({ apiKey: "" }),
    vi.fn(),
  );
  expect(await deps.listChangesCursor()).toBe(7);
  expect(await deps.getConversation("thread")).toMatchObject({
    revision: 3,
    activeRunId: "run",
    firstSeq: 8,
    messages: [{ id: "m", content: [{ type: "text", text: "reply" }] }],
  });
  expect(await deps.getConversation("missing")).toBeUndefined();
  const send = await deps.prepareSend();
  expect(await send('{"message":"hello"}')).toEqual({
    ok: true,
    data: { runId: "new-run" },
  });
  expect(request).toHaveBeenLastCalledWith(
    "https://backend/api/runs",
    expect.objectContaining({
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
    }),
  );
});
