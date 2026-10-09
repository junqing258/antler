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
  models: [],
  model: "",
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
      (value.model !== undefined && typeof value.model !== "string")
    )
      return defaultProviderConfig;
    // Migrate the original single-model configuration without losing it.
    const storedModels = Array.isArray(value.models) ? value.models : [];
    const selectedModel = value.model?.trim() ?? "";
    const models = storedModels
      .filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && !!candidate.trim(),
      )
      .map((candidate) => candidate.trim());
    const normalizedModels = [...new Set(models)];
    if (selectedModel && !normalizedModels.includes(selectedModel))
      normalizedModels.push(selectedModel);
    const model = selectedModel || normalizedModels[0] || "";
    return { ...value, model, models: normalizedModels } as ProviderConfig;
  } catch {
    return defaultProviderConfig;
  }
}

export function getModelPickerConfig(
  config: ProviderConfig,
  serverModel: string,
): Pick<ProviderConfig, "model" | "models"> {
  if (config.apiKey.trim()) return { model: config.model, models: config.models };
  return { model: serverModel, models: [] };
}

export function saveProviderConfig(config: ProviderConfig) {
  localStorage.setItem(PROVIDER_CONFIG_STORAGE_KEY, JSON.stringify(config));
}
