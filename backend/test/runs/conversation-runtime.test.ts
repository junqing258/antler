import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { ConversationStore } from "../../src/conversations/store.js";
import {
  AntlerHostRuntime,
  type ProviderRunConfig,
} from "../../src/agent/host-runtime.js";
import type { PiAgentAdapter } from "../../src/agent/pi-agent-adapter.js";
import { SecretGuard } from "../../src/agent/secret-guard.js";
let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let store: ConversationStore;
const runtimes: AntlerHostRuntime[] = [];
const provider: ProviderRunConfig = {
  protocol: "openai-responses",
  model: "test",
  baseUrl: "https://example.test/v1/",
  apiKey: "private-key-first-device",
};
const adapters: { key?: string; restored: AgentMessage[] }[] = [];
function runtime() {
  const result = new AntlerHostRuntime(
    (config) => {
      const state = { key: config?.apiKey, restored: [] as AgentMessage[] };
      adapters.push(state);
      return {
        secretGuard: new SecretGuard(undefined, undefined, [config?.apiKey]),
        importContext: (_id: string, messages: AgentMessage[]) => {
          state.restored = structuredClone(messages);
        },
        exportContext: () => state.restored,
        generateTitle: async () => "server title",
        run: async (
          input: string,
          _id: string,
          _snapshot: unknown,
          _signal: AbortSignal,
          emit: (event: unknown) => Promise<void>,
        ) => {
          state.restored.push({
            role: "user",
            content: input,
            timestamp: Date.now(),
          });
          await emit({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 0,
              delta: `memory:${state.restored.length}`,
            },
          });
          return state.restored;
        },
      } as unknown as PiAgentAdapter;
    },
    { maxRunDurationMs: 5000, maxEvents: 100 },
    undefined,
    store,
  );
  runtimes.push(result);
  return result;
}
async function finish() {
  await vi.waitFor(async () =>
    expect((await store.detail("alice", "thread"))?.activeRunId).toBeNull(),
  );
}
beforeEach(async () => {
  db = await schedulerDatabase();
  store = new ConversationStore(db);
  adapters.length = 0;
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.stop()));
  await db.$disconnect();
});
it("restores actual model checkpoints across runtime restart and valid credential rotation", async () => {
  const first = runtime();
  await first.createRunWithSkills("remember blue", {
    userId: "alice",
    conversationId: "thread",
    provider,
    clientRequestId: "request-one",
    expectedRevision: 0,
  });
  await finish();
  await first.stop();
  const second = runtime();
  const revision = (await store.detail("alice", "thread"))!.revision;
  await second.createRunWithSkills("what color", {
    userId: "alice",
    conversationId: "thread",
    provider: { ...provider, apiKey: "private-key-second-device" },
    clientRequestId: "request-two",
    expectedRevision: revision,
  });
  await finish();
  expect(adapters.at(-1)?.restored.map((message) => message.content)).toEqual([
    "remember blue",
    "what color",
  ]);
  const persisted = JSON.stringify(await db.conversation.findMany());
  expect(persisted).not.toContain(provider.apiKey);
  expect(persisted).not.toContain("private-key-second-device");
  expect(await store.detail("alice", "thread")).not.toHaveProperty(
    "checkpoint",
  );
});
it("deduplicates simultaneous sends and rejects mismatched payloads and missing credentials", async () => {
  const host = runtime();
  const options = {
    userId: "alice",
    conversationId: "thread",
    provider,
    clientRequestId: "request-one",
    expectedRevision: 0,
  };
  const [a, b] = await Promise.all([
    host.createRunWithSkills("hello", options),
    host.createRunWithSkills("hello", options),
  ]);
  expect(a.run.id).toBe(b.run.id);
  expect(await db.run.count()).toBe(1);
  await expect(
    host.createRunWithSkills("changed", options),
  ).rejects.toMatchObject({ code: "client_request_conflict" });
  await finish();
  await expect(
    host.createRunWithSkills("next", {
      userId: "alice",
      conversationId: "thread",
    }),
  ).rejects.toMatchObject({ code: "credential_required" });
});

it("keeps earlier credentials protected after rotating keys and degrades unsafe checkpoints explicitly", async () => {
  const host = runtime();
  await host.createRunWithSkills(`do not save ${provider.apiKey}`, {
    userId: "alice",
    conversationId: "thread",
    provider,
  });
  await finish();
  expect(
    (await db.conversation.findUnique({ where: { id: "thread" } }))
      ?.contextState,
  ).toBe("unavailable");
  await host.createRunWithSkills("rotate the credential", {
    userId: "alice",
    conversationId: "thread",
    provider: { ...provider, apiKey: "rotated-private-key" },
  });
  await finish();
  const row = await db.conversation.findUnique({ where: { id: "thread" } });
  expect(row?.contextState).toBe("unavailable");
  expect(JSON.stringify(row?.checkpoint)).not.toContain(provider.apiKey);
  const restarted = runtime();
  await expect(
    restarted.createRunWithSkills("continue", {
      userId: "alice",
      conversationId: "thread",
      provider,
    }),
  ).rejects.toMatchObject({ code: "conversation_context_not_restored" });
});
