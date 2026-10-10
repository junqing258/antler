import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  listProjects,
  updateProject,
  updateProjectKnowledgePolicy,
} from "@/lib/conversation-store";
import { initializeWorkspaceProjects } from "../../src/lib/workspace-projects";

const workingDirectory = "/srv/antler/workspace/Stock-Analysis";
const getServerInfo = async () => ({
  baseUrl: "http://localhost:3210",
  token: "test-token",
});

describe("workspace project initialization", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ workingDirectory }), { status: 200 }),
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds Stock-Analysis to Projects using the server's absolute directory", async () => {
    await initializeWorkspaceProjects(getServerInfo);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3210/api/directories?path=Stock-Analysis",
      expect.objectContaining({ headers: { "x-antler-token": "test-token" } }),
    );
    expect(await listProjects()).toEqual([
      expect.objectContaining({ id: "default", name: "General" }),
      expect.objectContaining({
        id: "workspace:Stock-Analysis",
        name: "Stock-Analysis",
        workingDirectory,
      }),
    ]);
  });

  it("creates only one project during concurrent and repeated startup", async () => {
    await Promise.all([
      initializeWorkspaceProjects(getServerInfo),
      initializeWorkspaceProjects(getServerInfo),
    ]);
    await initializeWorkspaceProjects(getServerInfo);

    expect((await listProjects()).filter((p) => p.name === "Stock-Analysis"))
      .toHaveLength(1);
  });

  it("reuses a project already associated with the directory", async () => {
    const existing = await createProject("My stocks", workingDirectory);

    expect(await initializeWorkspaceProjects(getServerInfo)).toEqual(existing);
    expect(await listProjects()).toHaveLength(2);
  });

  it("preserves changes made to an automatically added project", async () => {
    const project = await initializeWorkspaceProjects(getServerInfo);
    await updateProject(project!.id, {
      name: "My research",
      workingDirectory: "/srv/custom/research",
    });
    const edited = await updateProjectKnowledgePolicy(project!.id, "auto");

    expect(await initializeWorkspaceProjects(getServerInfo)).toEqual(edited);
    expect(await listProjects()).toHaveLength(2);
  });

  it("keeps local projects available when the directory is missing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 400 }));

    expect(await initializeWorkspaceProjects(getServerInfo)).toBeUndefined();
    expect(await listProjects()).toEqual([
      expect.objectContaining({ id: "default" }),
    ]);
  });

  it("keeps local projects available when the server is offline", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    expect(await initializeWorkspaceProjects(getServerInfo)).toBeUndefined();
    expect(await listProjects()).toHaveLength(1);
  });
});
