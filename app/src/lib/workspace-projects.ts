import { ensureWorkspaceProject, type Project } from "@/lib/conversation-store";

type ServerInfo = { baseUrl: string; token: string };

export async function initializeWorkspaceProjects(
  getServerInfo: () => Promise<ServerInfo>,
): Promise<Project | undefined> {
  try {
    const server = await getServerInfo();
    const response = await fetch(
      `${server.baseUrl}/api/directories?path=Stock-Analysis`,
      {
        headers: { "x-antler-token": server.token },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return undefined;
    const directory = (await response.json()) as { workingDirectory?: string };
    if (!directory.workingDirectory) return undefined;
    return await ensureWorkspaceProject("Stock-Analysis", directory.workingDirectory);
  } catch {
    // An unavailable server or missing directory must not block local chats.
    return undefined;
  }
}
