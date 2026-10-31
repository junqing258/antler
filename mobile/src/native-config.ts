export type NativeConfig = {
  serverUrl: string;
  authMode: "local" | "supabase";
  accessToken: string;
  conversationId: string;
  agentId: string;
  providerProtocol: "openai-responses" | "anthropic-messages";
  providerBaseUrl: string;
  providerModel: string;
  providerKey: string;
};
export const defaultNativeConfig: NativeConfig = {
  serverUrl: "",
  authMode: "local",
  accessToken: "",
  conversationId: "",
  agentId: "",
  providerProtocol: "openai-responses",
  providerBaseUrl: "",
  providerModel: "",
  providerKey: "",
};
export function validateServerUrl(value: string, allowHttp: boolean): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入有效的服务地址。");
  }
  if (
    (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("服务地址必须为 HTTPS 地址，不能包含凭据、查询或片段。");
  return url.toString().replace(/\/+$/, "");
}

/** Keep secrets separate and bind each to the endpoint that was saved with it. */
export function serializeNativeConfig(config: NativeConfig): {
  settings: string;
  secrets: string;
} {
  const { accessToken, providerKey, ...settings } = config;
  return {
    settings: JSON.stringify(settings),
    secrets: JSON.stringify({
      serverUrl: config.serverUrl,
      authMode: config.authMode,
      accessToken,
      providerProtocol: config.providerProtocol,
      providerBaseUrl: config.providerBaseUrl,
      providerKey,
    }),
  };
}
function objectFromJson(value: string | null): Record<string, unknown> {
  if (value === null) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("设备配置格式无效");
  return Object.fromEntries(Object.entries(parsed));
}
export function deserializeNativeConfig(
  settings: string | null,
  secrets: string | null,
): NativeConfig {
  const data = objectFromJson(settings);
  const saved = objectFromJson(secrets);
  const str = (key: keyof NativeConfig): string => {
    const value = data[key];
    if (value === undefined) return "";
    if (typeof value !== "string") throw new Error("设备配置格式无效");
    return value;
  };
  const authMode = data.authMode ?? "local";
  const providerProtocol = data.providerProtocol ?? "openai-responses";
  if (
    (authMode !== "local" && authMode !== "supabase") ||
    (providerProtocol !== "openai-responses" &&
      providerProtocol !== "anthropic-messages")
  )
    throw new Error("设备配置格式无效");
  const config: NativeConfig = {
    serverUrl: str("serverUrl"),
    authMode,
    accessToken: "",
    conversationId: str("conversationId"),
    agentId: str("agentId"),
    providerProtocol,
    providerBaseUrl: str("providerBaseUrl"),
    providerModel: str("providerModel"),
    providerKey: "",
  };
  if (
    saved.serverUrl === config.serverUrl &&
    saved.authMode === config.authMode &&
    typeof saved.accessToken === "string"
  )
    config.accessToken = saved.accessToken;
  if (
    saved.providerProtocol === config.providerProtocol &&
    saved.providerBaseUrl === config.providerBaseUrl &&
    typeof saved.providerKey === "string"
  )
    config.providerKey = saved.providerKey;
  return config;
}
