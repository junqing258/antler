export const PROVIDER_CONFIG_STORAGE_KEY = "antler.provider-config.v1";

export type ProviderProtocol = "openai-responses" | "anthropic-messages";

export type ProviderConfig = {
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  models: string[];
  model: string;
};

export const defaultProviderConfig: ProviderConfig = {
  name: "OpenAI",
  protocol: "openai-responses",
  baseUrl: "",
  apiKey: "",
  models: ["gpt-4.1-mini"],
  model: "gpt-4.1-mini",
};

export function loadProviderConfig(): ProviderConfig {
  try {
    const stored = localStorage.getItem(PROVIDER_CONFIG_STORAGE_KEY);
    if (!stored) return defaultProviderConfig;
    const value = JSON.parse(stored) as Partial<ProviderConfig>;
    if (
      (value.protocol !== "openai-responses" &&
        value.protocol !== "anthropic-messages") ||
      typeof value.name !== "string" ||
      typeof value.baseUrl !== "string" ||
      typeof value.apiKey !== "string" || typeof value.model !== "string"
    )
      return defaultProviderConfig;
    // Migrate the original single-model configuration without losing it.
    const models = Array.isArray(value.models)
      ? value.models.filter((model): model is string => typeof model === "string" && !!model.trim())
      : [value.model];
    return { ...value, models: models.length ? [...new Set(models)] : [value.model] } as ProviderConfig;
  } catch {
    return defaultProviderConfig;
  }
}

export function saveProviderConfig(config: ProviderConfig) {
  localStorage.setItem(PROVIDER_CONFIG_STORAGE_KEY, JSON.stringify(config));
}
