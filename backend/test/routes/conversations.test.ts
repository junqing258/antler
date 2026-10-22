import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, expect, it } from "vitest";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { registerConversationRoutes } from "../../src/routes/conversations.js";
import { PlatformError } from "../../src/platform/errors.js";
import type { AntlerHostRuntime } from "../../src/agent/host-runtime.js";
let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let app: FastifyInstance;
let store: ConversationStore;
beforeEach(async () => {
  db = await schedulerDatabase();
  store = new ConversationStore(db);
  app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.antlerUser = {
      id: String(request.headers["test-user"] ?? "alice"),
    };
  });
  app.setErrorHandler((error, _request, reply) =>
    error instanceof PlatformError
      ? reply.code(error.statusCode).send({ error: error.code })
      : reply.code(500).send({ error: "unexpected" }),
  );
  registerConversationRoutes(app, store, {
    hasConversationContext: () => false,
    cancel: async () => undefined,
  } as unknown as AntlerHostRuntime);
  await store.create({
    id: "run",
    userId: "alice",
    projectId: "default",
    conversationId: "thread",
    input: "hello",
    status: "queued",
    createdAt: new Date().toISOString(),
    executionConfig: { schemaVersion: 1 },
  });
});
afterEach(async () => {
  await app.close();
  await db.$disconnect();
});
it("isolates list, detail, messages, rename and delete APIs", async () => {
  for (const [method, url] of [
    ["GET", "/api/conversations/thread"],
    ["GET", "/api/conversations/thread/messages"],
    ["PATCH", "/api/conversations/thread"],
    ["DELETE", "/api/conversations/thread"],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: { "test-user": "bob" },
      ...(method === "PATCH"
        ? { payload: { title: "stolen", expectedRevision: 1 } }
        : {}),
    });
    expect(response.statusCode).toBe(404);
  }
  expect(
    (
      await app.inject({
        url: "/api/conversations",
        headers: { "test-user": "bob" },
      })
    ).json().conversations,
  ).toEqual([]);
  expect(
    (await app.inject({ url: "/api/conversations/thread" })).json(),
  ).not.toHaveProperty("checkpoint");
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/conversations/thread",
        payload: { title: "new", expectedRevision: 0 },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await app.inject({ method: "DELETE", url: "/api/conversations/thread" }))
      .statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: "DELETE", url: "/api/conversations/thread" }))
      .statusCode,
  ).toBe(200);
});
it("rejects invalid and future cursors without opening a stream", async () => {
  expect(
    (await app.inject({ url: "/api/conversations?limit=101" })).statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ url: "/api/conversations?cursor=invalid" })).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({ url: "/api/conversations/changes?afterChangeId=99" })
    ).json(),
  ).toEqual({ error: "reset_required" });
});
it("streams committed changes independently to two HTTP clients", async () => {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("missing address");
  const controllers = [new AbortController(), new AbortController()];
  try {
    const streams = await Promise.all(
      controllers.map((controller) =>
        fetch(
          `http://127.0.0.1:${address.port}/api/conversations/changes?afterChangeId=1`,
          { signal: controller.signal },
        ),
      ),
    );
    const readers = streams.map((response) => response.body!.getReader());
    await store.title("alice", "thread", "shared title", 1);
    const readChange = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
    ) => {
      let text = "";
      const decoder = new TextDecoder();
      while (!text.includes("event: conversation.changed")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("ended early");
        text += decoder.decode(value);
      }
      return JSON.parse(text.match(/^data: (.+)$/m)![1]);
    };
    const changes = await Promise.all(readers.map(readChange));
    expect(
      changes.map((change) => [
        change.changeId,
        change.revision,
        change.conversationId,
      ]),
    ).toEqual([
      [2, 2, "thread"],
      [2, 2, "thread"],
    ]);
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
});
