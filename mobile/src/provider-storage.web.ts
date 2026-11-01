import type { ProviderConfigDraft } from "@antler/ui";
import { loadNativeConfig } from "./native-storage.web";
import { parseProviderModels } from "./native-config";

// The web preview follows browser storage semantics; native builds use SecureStore.
const key = "antler.mobile-preview.provider.v1";
const listeners = new Set<() => void>();
export const defaultProvider: ProviderConfigDraft = {
  name: "OpenAI",
  protocol: "openai-responses",
  baseUrl: "",
  apiKey: "",
  models: [],
  model: "",
};
export function subscribeProviderConfig(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
export async function saveProviderConfig(config: ProviderConfigDraft) {
  localStorage.setItem(key, JSON.stringify(config));
  listeners.forEach((listener) => listener());
}
export async function loadProviderConfig(): Promise<ProviderConfigDraft> {
  const value = localStorage.getItem(key);
  if (value) {
    const saved = JSON.parse(value) as ProviderConfigDraft;
    if (
      !saved ||
      typeof saved.name !== "string" ||
      typeof saved.baseUrl !== "string" ||
      typeof saved.apiKey !== "string" ||
      typeof saved.model !== "string" ||
      !Array.isArray(saved.models) ||
      !saved.models.every((model) => typeof model === "string") ||
      (saved.protocol !== "openai-responses" &&
        saved.protocol !== "anthropic-messages")
    )
      throw new Error("供应商配置格式无效。");
    return saved;
  }
  const old = await loadNativeConfig();
  const models = parseProviderModels(old.providerModels);
  const model = old.providerModel.trim();
  if (model && !models.includes(model)) models.push(model);
  const migrated: ProviderConfigDraft = {
    name: "自定义供应商",
    protocol: old.providerProtocol,
    baseUrl: old.providerBaseUrl,
    apiKey: old.providerKey,
    models,
    model: model || models[0] || "",
  };
  localStorage.setItem(key, JSON.stringify(migrated));
  return migrated;
}
