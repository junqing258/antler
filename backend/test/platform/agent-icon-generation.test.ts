import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { generateAgentIcon } from "../../src/platform/agent-icon.js";
import type { AppConfig } from "../../src/config/env.js";

const streams = vi.hoisted(() => ({ openai: vi.fn<StreamFn>(), anthropic: vi.fn<StreamFn>() }));
vi.mock("@earendil-works/pi-ai/providers/openai", async (original) => {
  const { openaiProvider } = await original<typeof import("@earendil-works/pi-ai/providers/openai")>();
  return { openaiProvider: () => ({ getModels: () => openaiProvider().getModels(), streamSimple: streams.openai }) };
});
vi.mock("@earendil-works/pi-ai/providers/anthropic", async (original) => {
  const { anthropicProvider } = await original<typeof import("@earendil-works/pi-ai/providers/anthropic")>();
  return { anthropicProvider: () => ({ getModels: () => anthropicProvider().getModels(), streamSimple: streams.anthropic }) };
});
const config = { provider: "openai", model: "gpt-4.1-mini", openAiApiKey: "server-key" } as AppConfig;
beforeEach(() => { vi.clearAllMocks(); });
function respond(text: string): StreamFn {
  return (model) => {
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  };
}
describe("Agent icon inference", () => {
  it("uses the server model without tools", async () => {
    streams.openai.mockImplementation(respond("Search"));
    expect(await generateAgentIcon(config, "Research", "Find papers")).toBe("Search");
    const [model, context, options] = streams.openai.mock.calls[0]!;
    expect(model.id).toBe("gpt-4.1-mini");
    expect(getCurrentTools(context.messages) ?? []).toEqual([]);
    expect(options).toMatchObject({ apiKey: "server-key", maxTokens: 64, timeoutMs: 30_000 });
  });
  it("uses the configured gateway model and rejects invalid output", async () => {
    streams.anthropic.mockImplementation(respond("Brain"));
    const provider = { protocol: "anthropic-messages" as const, model: "private-model", apiKey: "custom-key", baseUrl: "https://model.test" };
    expect(await generateAgentIcon(config, "Tutor", "Teach", provider)).toBe("Brain");
    expect(streams.openai).not.toHaveBeenCalled();
    expect(streams.anthropic.mock.calls[0]![0]).toMatchObject({ id: "private-model", baseUrl: "https://model.test" });
    streams.anthropic.mockImplementation(respond("invented-icon"));
    await expect(generateAgentIcon(config, "Tutor", "Teach", provider)).rejects.toMatchObject({ statusCode: 502 });
  });
});
