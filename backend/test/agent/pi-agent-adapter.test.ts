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
import { createApp } from "../../src/app.js";
import { migratedWorkspace } from "../scheduler/helpers.js";

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
    it("checks contextFingerprint independently of an unchanged skill catalog", async () => {
      const { adapter, root } = await setup(provider);
      streams[provider].mockImplementation((model) =>
        completed(model, [{ type: "text", text: "Done." }], "stop"),
      );
      const snapshot = {
        ...DISABLED_SKILL_SNAPSHOT,
        workspaceRoot: root,
        contextFingerprint: "agent-context-v1",
      };
      await adapter.run(
        "first",
        "context-test",
        snapshot,
        new AbortController().signal,
        async () => {},
      );
      await expect(
        adapter.run(
          "next",
          "context-test",
          { ...snapshot, contextFingerprint: "agent-context-v2" },
          new AbortController().signal,
          async () => {},
        ),
      ).rejects.toMatchObject({ code: "agent_context_changed" });
    });

    it("creates platform tasks through a real run and can submit the scheduled Agent run", async () => {
      const { root, file } = await migratedWorkspace();
      roots.push(root);
      const app = createApp({
        host: "127.0.0.1",
        port: 3210,
        workspaceRoot: join(root, "workspace"),
        platformRoot: join(root, "platform"),
        databaseUrl: `file:${file}`,
        provider,
        model: provider === "openai" ? "gpt-4.1-mini" : "gateway-private-model",
        openAiApiKey: secret,
        anthropicAuthToken: secret,
        maxRunDurationMs: 5000,
      });
      let turn = 0;
      streams[provider].mockImplementation((model, context) => {
        expect(
          getCurrentTools(context.messages).map((tool) => tool.name),
        ).toEqual(
          expect.arrayContaining([
            "get_scheduler_time",
            "create_scheduled_task",
          ]),
        );
        const calls: Array<{ name: string; arguments: JsonObject }> = [
          { name: "get_scheduler_time", arguments: {} },
          {
            name: "create_scheduled_task",
            arguments: {
              name: "Agent daily summary",
              message: "Summarize the backend default workspace.",
              schedule: "0 9 * * *",
            },
          },
        ];
        const tool = calls[turn++];
        return tool
          ? completed(
              model,
              [{ type: "toolCall", id: `schedule-${turn}`, ...tool }],
              "toolUse",
            )
          : completed(model, [{ type: "text", text: "Done." }]);
      });
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: {
            projectId: "default",
            conversationId: "schedule-conversation",
            message: "每天早上 9 点汇总默认工作区",
            skillPolicy: { mode: "disabled" },
          },
        });
        expect(response.statusCode).toBe(202);
        const events = await app.inject(response.json().eventsUrl);
        expect(events.body).toContain('"status":"succeeded"');
        const list = (await app.inject("/api/scheduled-tasks")).json();
        expect(list.total).toBe(1);
        const task = list.tasks[0];
        expect(task).toMatchObject({
          type: "service",
          schedule: "0 9 * * *",
          payload: { service: "taskService", method: "create" },
        });
        const triggered = await app.inject({
          method: "POST",
          url: `/api/scheduled-tasks/${task.id}/trigger`,
        });
        expect(triggered.statusCode).toBe(202);
        const executionUrl = `/api/task-executions/${triggered.json().executionId}`;
        await expect
          .poll(async () => (await app.inject(executionUrl)).json().status)
          .toBe("succeeded");
        const execution = (await app.inject(executionUrl)).json();
        expect(execution.result).toMatchObject({
          input: "Summarize the backend default workspace.",
        });
        expect(execution.result.conversationId).not.toBe(
          "schedule-conversation",
        );
        const scheduledEvents = await app.inject(
          `/api/runs/${execution.result.id}/events`,
        );
        expect(scheduledEvents.body).toContain('"status":"succeeded"');
      } finally {
        await app.close();
      }
    });

    it("preserves user input verbatim across turns even when it matches a configured credential", async () => {
      const { adapter } = await setup(provider, {
        getToolEnvironment: () => ({ CUSTOM_API_KEY: "1" }),
      });
      const input = `发个测试邮件到 junqing258@126.com，另一个 user@163.com。${secret}`;
      streams[provider].mockImplementation((model, context) => {
        const users = context.messages.filter(
          (message) => message.role === "user",
        );
        expect(users[0].content).toEqual([{ type: "text", text: input }]);
        return completed(model, [{ type: "text", text: "收到" }]);
      });
      for (const message of [input, "继续"]) {
        await adapter.run(
          message,
          "verbatim",
          DISABLED_SKILL_SNAPSHOT,
          new AbortController().signal,
          () => {},
        );
      }
      expect(streams[provider]).toHaveBeenCalledTimes(2);
    });

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
        { name: "run_skill", arguments: { skillId: "example", command: 'test -f "$ANTLER_SKILL_DIR/SKILL.md" && echo skill-ran' } },
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
        expect(
          context.messages.find((message) => message.role === "user")?.content,
        ).toEqual([{ type: "text", text: `Question ${secret}` }]);
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
      expect(streams[provider]).toHaveBeenCalledTimes(5);
      expect(
        streams[provider === "openai" ? "anthropic" : "openai"],
      ).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.tavily.com/search",
        expect.any(Object),
      );
      const results = messages.filter((m) => m.role === "toolResult");
      expect(results).toHaveLength(4);
      expect(JSON.stringify(results)).toContain("skill-ran");
      expect(JSON.stringify(results)).toContain("Skill instructions.");
      expect(JSON.stringify(results)).toContain(`Note ${REDACTED}`);
      expect(JSON.stringify(results)).toContain("Search content.");
      expect(JSON.stringify(results)).not.toContain(secret);
      expect(
        events.filter((event) => event.type === "tool_execution_end"),
      ).toHaveLength(4);
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

    it("generates a bounded, redacted title with no tools and preserves chat history", async () => {
      const { adapter, config } = await setup(provider);
      streams[provider].mockImplementation((model) =>
        completed(model, [{ type: "text", text: "Original answer" }]),
      );
      await adapter.run(
        "Original goal",
        "title",
        DISABLED_SKILL_SNAPSHOT,
        new AbortController().signal,
        () => {},
      );
      streams[provider].mockImplementation((model, context, options) => {
        expect(model.id).toBe(config.model);
        expect(model.baseUrl).toBe(
          provider === "openai"
            ? config.openAiBaseUrl
            : config.anthropicBaseUrl,
        );
        expect(getCurrentTools(context.messages)).toEqual([]);
        expect(getCurrentSystemPrompt(context.messages)).toContain("简短标题");
        const transcript = JSON.stringify(context.messages);
        expect(transcript).toContain("用户主题");
        expect(transcript).toContain("助手回答");
        expect(transcript).toContain(secret);
        expect(transcript.length).toBeLessThan(13_000);
        expect(options?.maxTokens).toBe(128);
        if (provider === "openai") expect(options?.apiKey).toBe(secret);
        else expect(options?.headers?.Authorization).toBe(`Bearer ${secret}`);
        return completed(model, [
          { type: "text", text: `“主题概括 ${secret}”\n额外解释` },
        ]);
      });
      expect(
        await adapter.generateTitle(
          "title",
          `用户主题 ${secret}${"a".repeat(3980)}${secret}end`,
          `助手回答 ${secret}${"b".repeat(7980)}${secret}end`,
          new AbortController().signal,
        ),
      ).toBe(`主题概括 ${REDACTED}`);
      streams[provider].mockImplementation((model, context) => {
        expect(JSON.stringify(context.messages)).toContain("Original goal");
        expect(JSON.stringify(context.messages)).toContain("Original answer");
        expect(JSON.stringify(context.messages)).not.toContain("用户主题");
        expect(
          getCurrentTools(context.messages).map((tool) => tool.name),
        ).toContain("read");
        return completed(model, [{ type: "text", text: "Continued." }]);
      });
      await adapter.run(
        "Continue",
        "title",
        DISABLED_SKILL_SNAPSHOT,
        new AbortController().signal,
        () => {},
      );
    });

    it.each(["empty", "error", "long", "abort"])(
      "handles %s title generation",
      async (outcome) => {
        const { adapter } = await setup(provider);
        streams[provider].mockImplementation((model) =>
          completed(model, [{ type: "text", text: "Answer" }]),
        );
        await adapter.run(
          "Goal",
          "title",
          DISABLED_SKILL_SNAPSHOT,
          new AbortController().signal,
          () => {},
        );
        const controller = new AbortController();
        streams[provider].mockImplementation((model) => {
          if (outcome === "error") throw new Error(`Remote error ${secret}`);
          if (outcome === "abort") controller.abort();
          return completed(model, [
            { type: "text", text: outcome === "long" ? "题".repeat(100) : "" },
          ]);
        });
        const result = adapter.generateTitle(
          "title",
          "Goal",
          "Answer",
          controller.signal,
        );
        if (outcome === "long") expect(await result).toBe("题".repeat(48));
        else await expect(result).rejects.toThrow();
      },
    );

    it("compacts history and uses only the summary with original instructions/tools on the next run", async () => {
      const { adapter } = await setup(provider);
      const oldDetails = "Original conversation details. ".repeat(200);
      streams[provider].mockImplementation((model) =>
        completed(model, [{ type: "text", text: oldDetails }]),
      );
      await adapter.run(
        `Original goal ${secret} junqing258@126.com`,
        "compact",
        DISABLED_SKILL_SNAPSHOT,
        new AbortController().signal,
        () => {},
      );
      streams[provider].mockImplementation((model, context, options) => {
        expect(getCurrentTools(context.messages)).toEqual([]);
        expect(getCurrentSystemPrompt(context.messages)).toContain(
          "压缩会话上下文",
        );
        expect(JSON.stringify(context.messages)).toContain(oldDetails);
        expect(JSON.stringify(context.messages)).toContain(
          `Original goal ${secret} junqing258@126.com`,
        );
        expect(options?.maxTokens).toBe(2048);
        return completed(model, [
          { type: "text", text: `保留原目标，继续工作。${secret}` },
        ]);
      });
      const result = await adapter.compact(
        "compact",
        DISABLED_SKILL_SNAPSHOT,
        new AbortController().signal,
      );
      expect(result.beforeMessages).toBe(2);
      expect(result.afterBytes).toBeLessThan(result.beforeBytes);
      expect(result.summary).toBe(`保留原目标，继续工作。${REDACTED}`);
      streams[provider].mockImplementation((model, context) => {
        expect(context.messages).toHaveLength(3);
        expect(getCurrentSystemPrompt(context.messages)).toContain(
          `Base instructions ${REDACTED}`,
        );
        expect(
          getCurrentTools(context.messages).map((tool) => tool.name),
        ).toContain("read");
        expect(JSON.stringify(context.messages)).not.toContain(oldDetails);
        expect(JSON.stringify(context.messages)).not.toContain("Original goal");
        expect(JSON.stringify(context.messages)).toContain(result.summary);
        expect(JSON.stringify(context.messages)).not.toContain(secret);
        return completed(model, [{ type: "text", text: "Continued." }]);
      });
      await adapter.run(
        "Continue",
        "compact",
        DISABLED_SKILL_SNAPSHOT,
        new AbortController().signal,
        () => {},
      );
    });

    it.each(["error", "empty", "long", "tool", "abort"] as const)(
      "preserves history when compaction returns %s",
      async (failure) => {
        const { adapter } = await setup(provider);
        const original = "Important original context. ".repeat(200);
        streams[provider].mockImplementation((model) =>
          completed(model, [{ type: "text", text: original }]),
        );
        await adapter.run(
          "Keep this goal",
          "preserved",
          DISABLED_SKILL_SNAPSHOT,
          new AbortController().signal,
          () => {},
        );
        const controller = new AbortController();
        streams[provider].mockImplementation((model, _context, options) => {
          if (failure === "tool")
            return completed(
              model,
              [
                {
                  type: "toolCall",
                  id: "unexpected",
                  name: "bash",
                  arguments: { command: "exit 1" },
                },
              ],
              "toolUse",
            );
          if (failure === "empty" || failure === "long")
            return completed(model, [
              {
                type: "text",
                text: failure === "empty" ? " " : original.repeat(2),
              },
            ]);
          const stream = createAssistantMessageEventStream();
          const error = {
            ...message(model, [], failure === "abort" ? "aborted" : "error"),
            errorMessage: "Compaction failed",
          };
          if (failure === "abort") {
            options?.signal?.addEventListener(
              "abort",
              () => stream.push({ type: "error", reason: "aborted", error }),
              { once: true },
            );
            queueMicrotask(() => controller.abort());
          } else stream.push({ type: "error", reason: "error", error });
          return stream;
        });
        await expect(
          adapter.compact(
            "preserved",
            DISABLED_SKILL_SNAPSHOT,
            controller.signal,
          ),
        ).rejects.toThrow();
        streams[provider].mockImplementation((model, context) => {
          expect(JSON.stringify(context.messages)).toContain(original);
          expect(JSON.stringify(context.messages)).toContain("Keep this goal");
          expect(JSON.stringify(context.messages)).not.toContain(
            "此前会话的压缩摘要",
          );
          expect(
            getCurrentTools(context.messages).map((tool) => tool.name),
          ).toContain("bash");
          return completed(model, [{ type: "text", text: "Continued." }]);
        });
        await adapter.run(
          "Continue after failure",
          "preserved",
          DISABLED_SKILL_SNAPSHOT,
          new AbortController().signal,
          () => {},
        );
      },
    );

    it("rejects empty context and an already aborted compaction without calling the model", async () => {
      const { adapter } = await setup(provider);
      await expect(
        adapter.compact(
          "empty",
          DISABLED_SKILL_SNAPSHOT,
          new AbortController().signal,
        ),
      ).rejects.toThrow("没有可压缩");
      const controller = new AbortController();
      controller.abort();
      await expect(
        adapter.compact("empty", DISABLED_SKILL_SNAPSHOT, controller.signal),
      ).rejects.toThrow();
      expect(streams[provider]).not.toHaveBeenCalled();
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
