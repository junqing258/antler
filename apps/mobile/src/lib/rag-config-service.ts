import type { ClientPlatform } from "@antler/platform";

export type RagConfig = {
  ragUrl: string | null;
  ragKeyConfigured: boolean;
  ragConfigOverridden: boolean;
};

async function configRequest<T>(
  platform: ClientPlatform,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const connection = await platform.connection();
  const response = await platform.request(`${connection.baseUrl}/api/config${path}`, {
    ...init,
    headers: {
      ...connection.headers,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      typeof body.error === "string" && body.error
        ? body.error
        : "无法连接服务端，请检查网络后重试。",
    );
  return body as T;
}

export async function getRagConfig(platform: ClientPlatform): Promise<RagConfig> {
  const data = await configRequest<RagConfig>(platform, "");
  if (
    typeof data.ragKeyConfigured !== "boolean" ||
    typeof data.ragConfigOverridden !== "boolean"
  )
    throw new Error("知识库配置无效，请联系管理员。");
  return data;
}

export async function updateRagConfig(
  platform: ClientPlatform,
  value: { ragUrl: string; ragKey?: string },
): Promise<RagConfig> {
  return configRequest<RagConfig>(platform, "/rag", {
    method: "PUT",
    body: JSON.stringify({
      ragUrl: value.ragUrl,
      ...(value.ragKey !== undefined ? { ragKey: value.ragKey } : {}),
    }),
  });
}

export async function resetRagConfig(
  platform: ClientPlatform,
): Promise<RagConfig> {
  return configRequest<RagConfig>(platform, "/rag", { method: "DELETE" });
}
