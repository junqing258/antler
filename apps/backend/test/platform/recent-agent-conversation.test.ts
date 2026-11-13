import Fastify from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlatformService } from "../../src/platform/service.js";
import { registerAgentRoutes } from "../../src/routes/agents.js";
import { SkillRegistry } from "../../src/skills/skill-registry.js";
import { schedulerDatabase } from "../scheduler/helpers.js";

let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let service: PlatformService;
const app = Fastify();

beforeAll(async () => {
  db = await schedulerDatabase();
  service = new PlatformService(db, "/tmp/antler-recent-agent-test", new SkillRegistry());
  await db.agent.createMany({ data: [
    { id: "alpha", ownerId: "alice", name: "Alpha", description: "", systemPrompt: "", status: "published" },
    { id: "beta", ownerId: "bob", name: "Beta", description: "", systemPrompt: "", status: "published" },
    { id: "empty", ownerId: "alice", name: "Empty", description: "", systemPrompt: "" },
    { id: "hidden", ownerId: "bob", name: "Hidden", description: "", systemPrompt: "" },
  ] });
  await db.conversation.createMany({ data: [
    { id: "alpha-old", agentId: "alpha", userId: "alice", title: "旧对话", lastMessageAt: new Date("2026-11-14T08:00:00Z") },
    { id: "alpha-new-1", agentId: "alpha", userId: "alice", title: "同时的对话", lastMessageAt: new Date("2026-11-14T09:00:00Z") },
    { id: "alpha-new-2", agentId: "alpha", userId: "alice", title: "最新对话", lastMessageAt: new Date("2026-11-14T09:00:00Z") },
    { id: "alpha-bob", agentId: "alpha", userId: "bob", title: "Bob 的对话", lastMessageAt: new Date("2026-11-14T10:00:00Z") },
    { id: "alpha-deleted", agentId: "alpha", userId: "alice", title: "已删除", lastMessageAt: new Date("2026-11-14T11:00:00Z"), deletedAt: new Date() },
    { id: "alpha-local", agentId: "alpha", userId: "", title: "本地对话", lastMessageAt: new Date("2026-11-14T12:00:00Z") },
    { id: "beta-recent", agentId: "beta", userId: "alice", title: "Beta 的对话", lastMessageAt: new Date("2026-11-14T08:00:00Z") },
    { id: "hidden-recent", agentId: "hidden", userId: "alice", title: "隐藏 Agent", lastMessageAt: new Date("2026-11-14T13:00:00Z") },
    { id: "unbound", userId: "alice", title: "普通对话", lastMessageAt: new Date("2026-11-14T14:00:00Z") },
  ].map((row) => ({ ...row, executionConfig: {} })) });
  app.addHook("onRequest", async (request) => {
    request.antlerUser = { id: request.headers["x-user"] as string || "alice" };
  });
  registerAgentRoutes(app, service, "supabase");
});

afterAll(async () => {
  await app.close();
  await db?.$disconnect();
});

it("includes only the user's latest undeleted conversation for each visible Agent", async () => {
  const response = await app.inject("/api/agents?includeRecentConversation=1");
  expect(response.statusCode).toBe(200);
  const agents = response.json().agents;
  expect(agents.find((agent: { id: string }) => agent.id === "alpha").recentConversation).toEqual({
    id: "alpha-new-2", title: "最新对话", lastMessageAt: "2026-11-14T09:00:00.000Z",
  });
  expect(agents.find((agent: { id: string }) => agent.id === "beta").recentConversation.id).toBe("beta-recent");
  expect(agents.find((agent: { id: string }) => agent.id === "empty").recentConversation).toBeNull();
  expect(agents.map((agent: { id: string }) => agent.id)).not.toContain("hidden");
  expect(response.body).not.toContain("普通对话");
});

it("isolates account and local-mode recent conversations", async () => {
  const response = await app.inject({ url: "/api/agents?includeRecentConversation=1", headers: { "x-user": "bob" } });
  expect(response.json().agents.find((agent: { id: string }) => agent.id === "alpha").recentConversation.id).toBe("alpha-bob");
  const local = Fastify();
  registerAgentRoutes(local, service, "local");
  try {
    const result = await local.inject("/api/agents?includeRecentConversation=1");
    expect(result.json().agents.find((agent: { id: string }) => agent.id === "alpha").recentConversation.id).toBe("alpha-local");
  } finally {
    await local.close();
  }
});

it("keeps conversation summaries out of the default Agent list response", async () => {
  const response = await app.inject("/api/agents");
  expect(response.statusCode).toBe(200);
  for (const agent of response.json().agents) expect(agent).not.toHaveProperty("recentConversation");
});
