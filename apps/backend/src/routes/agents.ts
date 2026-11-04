import { parseProvider } from "./runs.js";
import type { ProviderRunConfig } from "../agent/host-runtime.js";
import { agentWorkspace } from "../platform/agent-workspace.js";
import { resolve } from "node:path";
import { isBuiltinAgent } from "../platform/builtin-agents.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlatformService } from "../platform/service.js";
import {
  canEdit,
  PlatformError,
  type AuthContext,
} from "../platform/errors.js";
export function platformAuth(
  request: FastifyRequest,
  authMode: "local" | "supabase",
): AuthContext {
  const userId = request.antlerUser?.id ?? "";
  if (authMode === "supabase" && !userId)
    throw new PlatformError("unauthorized", 401);
  return { userId, authMode };
}
export function registerAgentRoutes(
  app: FastifyInstance,
  service: PlatformService,
  authMode: "local" | "supabase",
  workspaceRoot = resolve(service.root, "../workspace"),
  generateIcon?: (name: string, description: string, provider?: ProviderRunConfig) => Promise<string>,
) {
  app.post("/api/agents/icon", async (req, reply) => {
    platformAuth(req, authMode);
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.length > 64 ||
      typeof body.description !== "string" || body.description.length > 1024)
      throw new PlatformError("agent_invalid", 422);
    if (!generateIcon) throw new PlatformError("图标生成不可用。", 503);
    let provider: ProviderRunConfig | undefined;
    try {
      provider = parseProvider(body.provider);
    } catch {
      throw new PlatformError("供应商配置无效。", 422);
    }
    try {
      return { icon: await generateIcon(body.name, body.description, provider) };
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      return reply.code(502).send({ error: "图标生成失败，请重试。" });
    }
  });
  app.get("/api/agents", async (req) => {
    const auth = platformAuth(req, authMode);
    const agents = await service.listAgents(
      auth,
      (req.query as { mine?: string }).mine === "1",
    );
    return {
      agents: agents.map((agent) => ({
        ...agent,
        editable: canEdit(agent, auth),
        builtin: isBuiltinAgent(agent.id),
      })),
    };
  });
  app.post("/api/agents", async (req, reply) => {
    const agent = await service.createAgent(
      req.body,
      platformAuth(req, authMode),
    );
    return reply.code(201).send({
      ...agent,
      defaultWorkspace: agentWorkspace(workspaceRoot, agent.id),
    });
  });
  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req) => {
    const auth = platformAuth(req, authMode);
    const agent = await service.getAgent(req.params.id, auth);
    const hasConversations =
      canEdit(agent, auth) &&
      (await service.prisma.run.count({ where: { agentId: agent.id } })) > 0;
    return {
      ...agent,
      editable: canEdit(agent, auth),
      builtin: isBuiltinAgent(agent.id),
      hasConversations,
      defaultWorkspace: agentWorkspace(workspaceRoot, agent.id),
    };
  });
  app.put<{ Params: { id: string } }>("/api/agents/:id", async (req) =>
    service.updateAgent(req.params.id, req.body, platformAuth(req, authMode)),
  );
  for (const action of ["publish", "unpublish"] as const)
    app.post<{ Params: { id: string } }>(
      `/api/agents/:id/${action}`,
      async (req) =>
        service.updateAgent(
          req.params.id,
          {},
          platformAuth(req, authMode),
          action,
        ),
    );
  app.delete<{ Params: { id: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      await service.deleteAgent(req.params.id, platformAuth(req, authMode));
      return reply.code(204).send();
    },
  );
}
