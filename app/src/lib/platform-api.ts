import { authHeaders, serverInfo } from "./server-info";
export type PlatformSkill = {
  id: string;
  name: string;
  description: string;
  state: string;
  fileCount: number;
  sizeBytes: number;
  bindable: boolean;
  unbindableReason?: string;
  editable: boolean;
  createdAt: string;
};
export type PlatformAgent = {
  builtin?: boolean;
  defaultWorkspace?: string;
  id: string;
  ownerId: string;
  name: string;
  description: string;
  systemPrompt: string;
  hasConversations?: boolean;
  status: "draft" | "published";
  editable: boolean;
  _count?: { skills: number };
  skills?: { skillId: string; skill: PlatformSkill }[];
};
export async function platformApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const server = await serverInfo();
  const response = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: {
      ...authHeaders(server),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      hasHiddenReferences?: boolean;
      agents?: { name: string }[];
    };
    throw new Error(
      [
        data.error ?? `请求失败 (${response.status})`,
        data.agents?.map((a) => a.name).join("、"),
        data.hasHiddenReferences ? "另有不可见 Agent 引用" : "",
      ]
        .filter(Boolean)
        .join("："),
    );
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
export function agentWorkspace(id: string) {
  return localStorage.getItem(`antler.agent.workspace.${id}`) ?? "";
}
