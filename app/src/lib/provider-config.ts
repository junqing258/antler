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
      typeof value.apiKey !== "string" ||
      typeof value.model !== "string" ||
      !value.model.trim()
    )
      return defaultProviderConfig;
    // Migrate the original single-model configuration without losing it.
    const storedModels = Array.isArray(value.models) ? value.models : [];
    const model = value.model.trim();
    const models = storedModels
      .filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && !!candidate.trim(),
      )
      .map((candidate) => candidate.trim());
    const normalizedModels = [...new Set(models)];
    if (!normalizedModels.includes(model)) normalizedModels.push(model);
    return { ...value, model, models: normalizedModels } as ProviderConfig;
  } catch {
    return defaultProviderConfig;
  }
}

export function saveProviderConfig(config: ProviderConfig) {
  localStorage.setItem(PROVIDER_CONFIG_STORAGE_KEY, JSON.stringify(config));
}
