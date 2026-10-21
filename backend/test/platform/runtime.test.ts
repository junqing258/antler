import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { schedulerDatabase, deferred } from "../scheduler/helpers.js";
import { AntlerHostRuntime, type Run } from "../../src/agent/host-runtime.js";
import type { PiAgentAdapter } from "../../src/agent/pi-agent-adapter.js";
import { PrismaRunStore } from "../../src/runs/run-store.js";
import { PlatformService } from "../../src/platform/service.js";
import { SkillRegistry } from "../../src/skills/skill-registry.js";
import { TaskService } from "../../src/services/task-service.js";
import { registerRunRoutes } from "../../src/routes/runs.js";
import { registerTaskRoutes } from "../../src/routes/tasks.js";
import { uploadBody } from "./helpers.js";
import { createWorkspaceTools } from "../../src/agent/workspace-tools.js";

let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let root: string,
  service: PlatformService,
  registry: SkillRegistry,
  store: PrismaRunStore;
let runtime: AntlerHostRuntime,
  runModel: ReturnType<typeof vi.fn>,
  factory: ReturnType<typeof vi.fn<(...args: any[]) => PiAgentAdapter>>;
const auth = { userId: "alice", authMode: "supabase" as const };
const agentInput = {
  name: "Agent",
  description: "Example",
  systemPrompt: "instructions",
};
const opts = (id = "conversation", agentId?: string, userId = "alice") => ({
  projectId: "default",
  conversationId: id,
  agentId,
  userId,
});
function restart(mode: "supabase" | "local" = "supabase") {
  factory = vi.fn(() => ({ run: runModel }) as unknown as PiAgentAdapter);
  runtime = new AntlerHostRuntime(
    factory,
    { maxRunDurationMs: 5000, maxEvents: 100, authMode: mode },
    registry,
    store,
    service,
  );
}
async function finished(run: Run) {
  await vi.waitFor(() =>
    expect(["succeeded", "failed", "cancelled"]).toContain(run.status),
  );
  // Wait for persistence and lease release, too.
  await new Promise((r) => setTimeout(r, 5));
}
beforeAll(async () => {
  db = await schedulerDatabase();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.run.deleteMany();
  await db.agent.deleteMany();
  await db.skill.deleteMany();
  root = await mkdtemp(join(tmpdir(), "antler-run-platform-"));
  registry = new SkillRegistry(join(root, "empty"));
  service = new PlatformService(db, root, registry);
  store = new PrismaRunStore(db);
  runModel = vi.fn(async () => {});
  restart();
});
afterEach(async () => {
  await runtime.stop();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("run preflight", () => {
  it("allows repeated author draft debugging, inherits Agent binding and persists all four context fields", async () => {
    const skill = await service.upload(uploadBody(), auth);
    const agent = await service.createAgent(
      { ...agentInput, skillIds: [skill.id] },
      auth,
    );
    const first = await runtime.createRun("first", {
      ...opts("conversation", agent.id),
      skillPolicy: { mode: "disabled" },
    });
    await finished(first);
    expect(first).toMatchObject({
      agentId: agent.id,
      skillPolicy: { mode: "selected", skillIds: [skill.name] },
    });
    expect(await store.getLatestByConversation("conversation")).toMatchObject({
      agentId: agent.id,
      agentFingerprint: first.agentFingerprint,
      catalogFingerprint: first.catalogFingerprint,
      skillPolicy: first.skillPolicy,
      userId: "alice",
    });
    const second = await new TaskService(runtime).create(
      "second",
      "conversation",
      "alice",
    );
    await finished(second);
    expect(second.agentId).toBe(agent.id);
    expect(factory.mock.calls[0]![2]).toMatchObject({
      agentId: agent.id,
      skillIds: ["sample-skill"],
    });
    restart();
    const restored = await runtime.createRun("third", opts());
    await finished(restored);
    expect(restored.agentId).toBe(agent.id);
  });
  it.each([false, true])(
    "rejects same-content identity changes and prompt changes after restart=%s",
    async (reboot) => {
      const a = await service.createAgent(agentInput, auth),
        b = await service.createAgent(agentInput, auth);
      const first = await runtime.createRun(
        "first",
        opts("conversation", a.id),
      );
      await finished(first);
      if (reboot) restart();
      await expect(
        runtime.createRun("switch", opts("conversation", b.id)),
      ).rejects.toMatchObject({ code: "agent_changed" });
      await service.updateAgent(a.id, { systemPrompt: "changed" }, auth);
      await expect(runtime.createRun("continue", opts())).rejects.toMatchObject(
        { code: "agent_context_changed" },
      );
      expect(await db.run.count()).toBe(1);
      expect(runModel).toHaveBeenCalledTimes(1);
    },
  );
  it.each([false, true])(
    "rechecks inherited visibility, deletion and conversation ownership after restart=%s",
    async (reboot) => {
      const agent = await service.createAgent(agentInput, auth);
      await service.updateAgent(agent.id, {}, auth, "publish");
      const first = await runtime.createRun(
        "first",
        opts("conversation", agent.id, "bob"),
      );
      await finished(first);
      const own = await runtime.createRun("first", opts("own", agent.id));
      await finished(own);
      if (reboot) restart();
      for (const agentId of [agent.id, undefined])
        await expect(
          runtime.createRun("steal", opts("conversation", agentId)),
        ).rejects.toMatchObject({ code: "conversation_not_found" });
      await service.updateAgent(agent.id, {}, auth, "unpublish");
      await expect(
        runtime.createRun("continue", opts("conversation", undefined, "bob")),
      ).rejects.toMatchObject({ code: "agent_not_found" });
      const debug = await runtime.createRun("debug", opts("own"));
      await finished(debug);
      await service.deleteAgent(agent.id, auth);
      await expect(
        runtime.createRun("deleted", opts("own")),
      ).rejects.toMatchObject({ code: "agent_not_found" });
      expect(await db.run.count()).toBe(3);
    },
  );
  it("rejects tampering in resources, added files, renamed files and deleted files", async () => {
    const skill = await service.upload(uploadBody(), auth);
    const agent = await service.createAgent(
      { ...agentInput, skillIds: [skill.id] },
      auth,
    );
    const first = await runtime.createRun(
      "first",
      opts("conversation", agent.id),
    );
    await finished(first);
    await writeFile(join(root, skill.directory, "additional.txt"), "added");
    await expect(runtime.createRun("continue", opts())).rejects.toMatchObject({
      code: "agent_skills_unavailable",
    });
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id: skill.id } })).state,
    ).toBe("tampered");
    await service.upload(uploadBody("new description"), auth, skill.id);
    await expect(runtime.createRun("continue", opts())).rejects.toMatchObject({
      code: "agent_context_changed",
    });
    const fresh = await runtime.createRun(
      "new conversation",
      opts("new", agent.id),
    );
    await finished(fresh);
  });
  it.each(["preflight", "insert"])(
    "reserves the conversation before asynchronous %s and releases after failures",
    async (phase) => {
      const agent = await service.createAgent(agentInput, auth),
        other = await service.createAgent(agentInput, auth);
      const gate = deferred<void>(),
        entered = deferred<void>();
      if (phase === "preflight") {
        const original = service.getAgent.bind(service);
        vi.spyOn(service, "getAgent").mockImplementationOnce(
          async (...args) => {
            entered.resolve();
            await gate.promise;
            return original(...args);
          },
        );
      } else {
        const original = store.create.bind(store);
        vi.spyOn(store, "create").mockImplementationOnce(async (...args) => {
          entered.resolve();
          await gate.promise;
          return original(...args);
        });
      }
      const first = runtime.createRun("first", opts("conversation", agent.id));
      await entered.promise;
      await expect(
        runtime.createRunWithSkills("racing", opts("conversation", other.id)),
      ).rejects.toThrow("conversation_busy");
      gate.resolve();
      await finished(await first);
      await expect(
        runtime.createRun("switch", opts("conversation", other.id)),
      ).rejects.toMatchObject({ code: "agent_changed" });
      vi.spyOn(store, "create").mockRejectedValueOnce(
        new Error("insert failure"),
      );
      await expect(
        runtime.createRun("bad", opts("retry", agent.id)),
      ).rejects.toThrow("insert failure");
      const retry = await runtime.createRun("retry", opts("retry", other.id));
      await finished(retry);
    },
  );
  it("releases skills after adapter initialization failures and retains the committed binding", async () => {
    const skill = await service.upload(uploadBody(), auth),
      agent = await service.createAgent(
        { ...agentInput, skillIds: [skill.id] },
        auth,
      );
    factory.mockImplementationOnce(() => {
      throw new Error("init failed");
    });
    await expect(
      runtime.createRun("first", opts("conversation", agent.id)),
    ).rejects.toThrow("init failed");
    expect(await store.getLatestByConversation("conversation")).toMatchObject({
      status: "failed",
      agentId: agent.id,
      errorCode: "run_initialization_failed",
    });
    await service.upload(uploadBody(), auth, skill.id);
    const retry = await runtime.createRun("retry", opts());
    await finished(retry);
  });
  it("holds the read lease until model/tools finish and releases it on model failure", async () => {
    const skill = await service.upload(uploadBody(), auth),
      agent = await service.createAgent(
        { ...agentInput, skillIds: [skill.id] },
        auth,
      );
    const gate = deferred<void>();
    runModel.mockImplementationOnce(async () => {
      await gate.promise;
      throw new Error("model failed");
    });
    const first = await runtime.createRun(
      "first",
      opts("conversation", agent.id),
    );
    let updated = false;
    const update = service
      .upload(uploadBody("updated"), auth, skill.id)
      .then(() => {
        updated = true;
      });
    await new Promise((r) => setTimeout(r, 25));
    expect(updated).toBe(false);
    gate.resolve();
    await finished(first);
    await update;
    expect(updated).toBe(true);
  });
  it("establishes a one-time historical skill baseline and never guesses partially missing fields", async () => {
    await store.create({
      id: "legacy",
      userId: "alice",
      projectId: "default",
      conversationId: "conversation",
      input: "old",
      status: "succeeded",
      createdAt: new Date(0).toISOString(),
    });
    const first = await runtime.createRun("upgrade", opts());
    await finished(first);
    expect(first).toMatchObject({
      agentId: null,
      agentFingerprint: "none",
      skillPolicy: { mode: "disabled" },
      catalogFingerprint: "sha256:disabled",
    });
    restart();
    const restored = await runtime.createRun("restore", opts());
    await finished(restored);
    await expect(
      runtime.createRunWithSkills("policy changed", opts()),
    ).rejects.toThrow("conversation_skill_context_mismatch");
    await db.run.update({
      where: { id: restored.id },
      data: { catalogFingerprint: null },
    });
    restart();
    await expect(runtime.createRun("corrupt", opts())).rejects.toMatchObject({
      code: "conversation_context_invalid",
    });
  });
  it.each([
    { userId: "", agentId: null, agentFingerprint: null },
    {
      userId: "alice",
      agentId: "agent-without-fingerprint",
      agentFingerprint: null,
    },
    { userId: "alice", agentId: "agent", agentFingerprint: "fingerprint" },
    {
      userId: "alice",
      agentId: null,
      agentFingerprint: "none",
      skillPolicy: { mode: "invalid" },
      catalogFingerprint: "sha256:test",
    },
  ])("rejects corrupt or unowned historical context %j", async (fields) => {
    await db.run.create({
      data: {
        id: "bad",
        projectId: "default",
        conversationId: "conversation",
        input: "old",
        status: "succeeded",
        ...fields,
      },
    });
    await expect(runtime.createRun("continue", opts())).rejects.toBeDefined();
    expect(runModel).not.toHaveBeenCalled();
  });
  it("rejects historical mixed owners and treats local mode as one user", async () => {
    for (const userId of ["alice", "bob"])
      await db.run.create({
        data: {
          id: userId,
          userId,
          projectId: "default",
          conversationId: "conversation",
          input: "old",
          status: "succeeded",
        },
      });
    await expect(runtime.createRun("continue", opts())).rejects.toMatchObject({
      code: "conversation_not_found",
    });
    await db.run.deleteMany();
    restart("local");
    const first = await runtime.createRun("first", opts());
    await finished(first);
    const second = await runtime.createRun(
      "second",
      opts("conversation", undefined, "bob"),
    );
    await finished(second);
    expect(second.userId).toBe("alice");
  });
  it("enforces constraints even when a scheduled payload inherits an Agent", async () => {
    const agent = await service.createAgent(agentInput, auth);
    await service.updateAgent(agent.id, {}, auth, "publish");
    const first = await runtime.createRun(
      "first",
      opts("conversation", agent.id),
    );
    await finished(first);
    for (const constraints of [
      { requirePublished: true, requireFrozenAgentFields: true },
      {
        requirePublished: true,
        requireFrozenAgentFields: true,
        frozenAgentFieldsPresent: false,
        expectedAgentFingerprint: first.agentFingerprint!,
      },
    ])
      await expect(
        runtime.createRun("missing frozen fields", {
          ...opts(),
          agentConstraints: constraints,
        }),
      ).rejects.toMatchObject({
        code: "agent_frozen_fields_missing",
        retryable: false,
      });
    await service.updateAgent(agent.id, {}, auth, "unpublish");
    await expect(
      runtime.createRun("scheduled draft", {
        ...opts(),
        agentConstraints: { requirePublished: true },
      }),
    ).rejects.toMatchObject({ code: "agent_not_published" });
    expect(await db.run.count()).toBe(1);
  });
  it("applies ownership, inheritance and content errors at both HTTP run entrances", async () => {
    const app = Fastify();
    app.addHook("preHandler", async (req) => {
      req.antlerUser = { id: (req.headers["x-user"] as string) ?? "alice" };
    });
    registerRunRoutes(app, runtime);
    registerTaskRoutes(app, new TaskService(runtime));
    try {
      const agent = await service.createAgent(agentInput, auth);
      await service.updateAgent(agent.id, {}, auth, "publish");
      const first = await runtime.createRun(
        "first",
        opts("conversation", agent.id),
      );
      await finished(first);
      for (const url of ["/api/runs", "/api/tasks"]) {
        const stolen = await app.inject({
          method: "POST",
          url,
          headers: { "x-user": "bob" },
          payload: {
            message: "steal",
            projectId: "default",
            conversationId: "conversation",
            agentId: agent.id,
          },
        });
        expect(stolen.statusCode).toBe(404);
        const response = await app.inject({
          method: "POST",
          url,
          payload: {
            message: "continue",
            projectId: "default",
            conversationId: "conversation",
          },
        });
        expect(response.statusCode).toBe(202);
        await vi.waitFor(async () =>
          expect((await store.get(response.json().runId))?.status).toBe(
            "succeeded",
          ),
        );
        await new Promise((r) => setTimeout(r, 5));
      }
      await service.updateAgent(
        agent.id,
        { systemPrompt: "new content" },
        auth,
      );
      for (const url of ["/api/runs", "/api/tasks"])
        expect(
          (
            await app.inject({
              method: "POST",
              url,
              payload: {
                message: "continue",
                projectId: "default",
                conversationId: "conversation",
              },
            })
          ).json(),
        ).toMatchObject({ error: "agent_context_changed" });
    } finally {
      await app.close();
    }
  });
  it("denies workspace tools access to a nested platform root", async () => {
    const path = join(root, "platform");
    await (await import("node:fs/promises")).mkdir(path);
    await writeFile(join(path, "data"), "private");
    const tools = createWorkspaceTools(root, undefined, undefined, path);
    for (const [tool, args] of [
      [tools[0], { path: "platform/data" }],
      [tools[1], { path: "platform/new", content: "bad" }],
      [tools[2], { path: "platform/data", oldText: "private", newText: "bad" }],
    ] as const)
      await expect(tool!.execute("test", args)).rejects.toThrow(
        "platform_path_denied",
      );
  });
});
