import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Api,
  type AssistantMessage,
  type JsonObject,
  type Model,
} from "@earendil-works/pi-ai";
import {
  PiAgentAdapter,
  type PiAgentAdapterConfig,
} from "../../src/agent/pi-agent-adapter.js";
import { SkillRegistry } from "../../src/skills/skill-registry.js";
import { createSkillSnapshot } from "../../src/skills/skill-policy.js";
import { DISABLED_SKILL_SNAPSHOT } from "../../src/skills/types.js";
import { REDACTED } from "../../src/agent/secret-guard.js";

const streams = vi.hoisted(() => ({
  openai: vi.fn<StreamFn>(),
  anthropic: vi.fn<StreamFn>(),
}));

// Keep the real provider catalogs and the real Agent; replace only remote streams.
vi.mock("@earendil-works/pi-ai/providers/openai", async (importOriginal) => {
  const { openaiProvider } =
    await importOriginal<
      typeof import("@earendil-works/pi-ai/providers/openai")
    >();
  const provider = openaiProvider();
  return {
    openaiProvider: () => ({
      getModels: () => provider.getModels(),
      streamSimple: streams.openai,
    }),
  };
});
vi.mock("@earendil-works/pi-ai/providers/anthropic", async (importOriginal) => {
  const { anthropicProvider } =
    await importOriginal<
      typeof import("@earendil-works/pi-ai/providers/anthropic")
    >();
  const provider = anthropicProvider();
  return {
    anthropicProvider: () => ({
      getModels: () => provider.getModels(),
      streamSimple: streams.anthropic,
    }),
  };
});

const roots: string[] = [];
const secret = "test-pi-adapter-secret-value";

beforeEach(() => {
  streams.openai.mockReset();
  streams.anthropic.mockReset();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup(
  provider: "openai" | "anthropic",
  extra: Partial<PiAgentAdapterConfig> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "antler-pi-adapter-"));
  roots.push(root);
  const config: PiAgentAdapterConfig = {
    provider,
    model: provider === "openai" ? "gpt-4.1-mini" : "gateway-private-model",
    openAiApiKey: secret,
    anthropicAuthToken: secret,
    openAiBaseUrl: "https://openai.example.test/v1",
    anthropicBaseUrl: "https://anthropic.example.test",
    workspaceRoot: root,
    systemPrompt: `Base instructions ${secret}`,
    requestTimeoutMs: 1234,
    ...extra,
  };
  return { root, config, adapter: new PiAgentAdapter(config) };
}

function message(
  model: Model<Api>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    stopReason,
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function completed(
  model: Model<Api>,
  content: AssistantMessage["content"],
  reason: "stop" | "toolUse" = "stop",
) {
  const stream = createAssistantMessageEventStream();
  const result = message(model, content, reason);
  stream.push({ type: "start", partial: result });
  if (reason === "stop") {
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "Done.",
      partial: result,
    });
  }
  stream.push({ type: "done", reason, message: result });
  return stream;
}

describe.each(["openai", "anthropic"] as const)(
  "Pi 1.1.0 %s adapter",
  (provider) => {
    it("replays system/tools in transcript and executes skill, workspace and search tools", async () => {
      const { root, config, adapter } = await setup(provider, {
        tavilyApiKey: "test-tavily-key",
      });
      const directory = join(root, ".agents", "skills", "example");
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "SKILL.md"),
        "---\nname: example\ndescription: Example skill.\n---\nSkill instructions.",
      );
      await writeFile(join(root, "note.txt"), `Note ${secret}`);
      const catalog = await new SkillRegistry(
        join(root, "users"),
        join(root, "bundled"),
      ).list(root);
      const snapshot = createSkillSnapshot(root, { mode: "auto" }, catalog);
      const fetchMock = vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "Result",
              url: "https://example.test",
              content: "Search content.",
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const tools: Array<{ name: string; arguments: JsonObject }> = [
        { name: "load_skill", arguments: { skillId: "example" } },
        { name: "read", arguments: { path: "note.txt" } },
        { name: "web_search", arguments: { query: "example" } },
      ];
      let turn = 0;
      streams[provider].mockImplementation((model, context, options) => {
        expect(context).not.toHaveProperty("systemPrompt");
        expect(context).not.toHaveProperty("tools");
        expect(context.messages[0].role).toBe("system");
        expect(getCurrentSystemPrompt(context.messages)).toContain(
          `Base instructions ${REDACTED}`,
        );
        expect(getCurrentSystemPrompt(context.messages)).toContain(
          'id="example"',
        );
        expect(
          getCurrentTools(context.messages).map((tool) => tool.name),
        ).toEqual(expect.arrayContaining(tools.map((tool) => tool.name)));
        expect(JSON.stringify(context.messages)).not.toContain(secret);
        expect(options?.timeoutMs).toBe(1234);
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(model.baseUrl).toBe(
          provider === "openai"
            ? config.openAiBaseUrl
            : config.anthropicBaseUrl,
        );
        expect(model.id).toBe(config.model);
        if (provider === "openai") expect(options?.apiKey).toBe(secret);
        else expect(options?.headers?.Authorization).toBe(`Bearer ${secret}`);
        const tool = tools[turn++];
        return tool
          ? completed(
              model,
              [{ type: "toolCall", id: `tool-${turn}`, ...tool }],
              "toolUse",
            )
          : completed(model, [{ type: "text", text: "Done." }]);
      });
      const events: AgentEvent[] = [];
      const messages = await adapter.run(
        `Question ${secret}`,
        "conversation",
        snapshot,
        new AbortController().signal,
        (event) => {
          events.push(event);
        },
      );
      expect(streams[provider]).toHaveBeenCalledTimes(4);
      expect(
        streams[provider === "openai" ? "anthropic" : "openai"],
      ).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.tavily.com/search",
        expect.any(Object),
      );
      const results = messages.filter((m) => m.role === "toolResult");
      expect(results).toHaveLength(3);
      expect(JSON.stringify(results)).toContain("Skill instructions.");
      expect(JSON.stringify(results)).toContain(`Note ${REDACTED}`);
      expect(JSON.stringify(results)).toContain("Search content.");
      expect(JSON.stringify(results)).not.toContain(secret);
      expect(
        events.filter((event) => event.type === "tool_execution_end"),
      ).toHaveLength(3);
      expect(
        events.some(
          (event) =>
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta",
        ),
      ).toBe(true);
      // A second prompt reuses the real Agent's transcript, including previous tool results.
      await adapter.run(
        "Follow up",
        "conversation",
        snapshot,
        new AbortController().signal,
        () => {},
      );
      expect(
        streams[provider].mock.calls
          .at(-1)![1]
          .messages.filter((m) => m.role === "user"),
      ).toHaveLength(2);
    });

    it("propagates streamed errors and aborts through the real Agent", async () => {
      const { adapter } = await setup(provider);
      streams[provider].mockImplementation((model) => {
        const stream = createAssistantMessageEventStream();
        const error = {
          ...message(model, [], "error"),
          errorMessage: "Simulated timeout",
        };
        stream.push({ type: "error", reason: "error", error });
        return stream;
      });
      await expect(
        adapter.run(
          "Fail",
          "error",
          DISABLED_SKILL_SNAPSHOT,
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow("Simulated timeout");

      const controller = new AbortController();
      streams[provider].mockImplementation((model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        options?.signal?.addEventListener(
          "abort",
          () => {
            const error = {
              ...message(model, [], "aborted"),
              errorMessage: "Cancelled",
            };
            stream.push({ type: "error", reason: "aborted", error });
          },
          { once: true },
        );
        queueMicrotask(() => controller.abort());
        return stream;
      });
      await expect(
        adapter.run(
          "Cancel",
          "cancel",
          DISABLED_SKILL_SNAPSHOT,
          controller.signal,
          () => {},
        ),
      ).rejects.toThrow("Cancelled");
      expect(streams[provider].mock.calls.at(-1)![2]?.signal?.aborted).toBe(
        true,
      );
    });

    it("rejects missing credentials before streaming", async () => {
      const { adapter } = await setup(provider, {
        openAiApiKey: undefined,
        anthropicAuthToken: undefined,
      });
      await expect(
        adapter.run(
          "Question",
          "missing-key",
          DISABLED_SKILL_SNAPSHOT,
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toMatchObject({ code: "provider_not_configured" });
      expect(streams[provider]).not.toHaveBeenCalled();
    });
  },
);

it("rejects OpenAI models outside the catalog", async () => {
  const { adapter } = await setup("openai", { model: "unknown-openai-model" });
  await expect(
    adapter.run(
      "Question",
      "unknown-model",
      DISABLED_SKILL_SNAPSHOT,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toMatchObject({ code: "model_not_found" });
  expect(streams.openai).not.toHaveBeenCalled();
});
