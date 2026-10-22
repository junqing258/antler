import { schedulerDatabase } from "../scheduler/helpers.js";
import { SkillRegistry } from "../../src/skills/skill-registry.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAgentRoutes } from "../../src/routes/agents.js";
import { PlatformService } from "../../src/platform/service.js";
import { generateAgentIcon, isAgentIcon } from "../../src/platform/agent-icon.js";
import type { AppConfig } from "../../src/config/env.js";

const config = { provider: "openai", model: "gpt-4.1-mini" } as AppConfig;

describe("Agent icons", () => {
  it("persists and validates icons without invalidating chat context", async () => {
    const db = await schedulerDatabase();
    const service = new PlatformService(db, "/tmp/antler-icon-test", new SkillRegistry());
    const auth = { userId: "", authMode: "local" as const };
    try {
      const agent = await service.createAgent({ name: "Research", description: "Find papers", systemPrompt: "Research", icon: "Search" }, auth);
      expect((await service.getAgent(agent.id, auth)).icon).toBe("Search");
      const before = await service.resolveAgent(agent.id, auth);
      before.release();
      await service.updateAgent(agent.id, { icon: "Brain" }, auth);
      expect((await service.listAgents(auth))[0]!.icon).toBe("Brain");
      const after = await service.resolveAgent(agent.id, auth);
      after.release();
      expect(after.context.agentFingerprint).toBe(before.context.agentFingerprint);
      await expect(service.updateAgent(agent.id, { icon: "Unknown" }, auth)).rejects.toMatchObject({ statusCode: 422 });
    } finally {
      await db.$disconnect();
    }
  });

  it("validates the icon catalog and rejects missing credentials", async () => {
    expect(isAgentIcon("Brain")).toBe(true);
    expect(isAgentIcon("<svg>" )).toBe(false);
    await expect(generateAgentIcon(config, "Research", "Search papers")).rejects.toMatchObject({ statusCode: 422 });
  });

  it("validates requests and passes configured provider to inference without exposing failures", async () => {
    const app = Fastify();
    const generate = vi.fn().mockResolvedValue("Search");
    registerAgentRoutes(app, { root: "/tmp" } as PlatformService, "local", "/tmp", generate);
    const provider = { protocol: "openai-responses", apiKey: "test-key", model: "custom", baseUrl: "https://model.test" };
    try {
      const result = await app.inject({ method: "POST", url: "/api/agents/icon", payload: { name: "Research", description: "Search papers", provider } });
      expect(result.json()).toEqual({ icon: "Search" });
      expect(generate).toHaveBeenCalledWith("Research", "Search papers", provider);
      generate.mockRejectedValue(new Error("upstream secret-key"));
      const failed = await app.inject({ method: "POST", url: "/api/agents/icon", payload: { name: "Research", description: "Search papers" } });
      expect(failed.statusCode).toBe(502);
      expect(failed.body).not.toContain("secret-key");
      const invalid = await app.inject({ method: "POST", url: "/api/agents/icon", payload: { name: "", description: "" } });
      expect(invalid.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });
});
