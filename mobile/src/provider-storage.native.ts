import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { ProviderConfigDraft } from "@antler/ui";
import { loadNativeConfig } from "./native-storage";
import { parseProviderModels } from "./native-config";

const settingsKey = "antler.provider.settings.v1";
const secretKey = "antler.provider.credentials.v1";
const migrationKey = "antler.provider.migrated.v1";
export const defaultProvider: ProviderConfigDraft = {
  name: "OpenAI",
  protocol: "openai-responses",
  baseUrl: "",
  apiKey: "",
  models: [],
  model: "",
};
const listeners = new Set<() => void>();
export function subscribeProviderConfig(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
type CredentialSlot = "a" | "b";
type StoredSettings = Omit<ProviderConfigDraft, "apiKey"> & {
  credentialSlot?: CredentialSlot;
};

function parseSettings(raw: string): StoredSettings {
  const value = JSON.parse(raw) as StoredSettings;
  if (
    !value ||
    typeof value.name !== "string" ||
    typeof value.baseUrl !== "string" ||
    (value.protocol !== "openai-responses" &&
      value.protocol !== "anthropic-messages") ||
    !Array.isArray(value.models) ||
    !value.models.every((v) => typeof v === "string") ||
    typeof value.model !== "string" ||
    (value.credentialSlot !== undefined &&
      value.credentialSlot !== "a" &&
      value.credentialSlot !== "b")
  )
    throw new Error("供应商配置格式无效。");
  return value;
}
function credentialKey(slot?: CredentialSlot): string {
  return slot ? `${secretKey}.${slot}` : secretKey;
}
async function readSaved(): Promise<ProviderConfigDraft | null> {
  const raw = await AsyncStorage.getItem(settingsKey);
  if (!raw) return null;
  const { credentialSlot, ...value } = parseSettings(raw);
  const secret = await SecureStore.getItemAsync(credentialKey(credentialSlot));
  // A save may have committed and retired this slot during the read.
  if ((await AsyncStorage.getItem(settingsKey)) !== raw) return readSaved();
  const credentials = secret
    ? (JSON.parse(secret) as {
        protocol?: string;
        baseUrl?: string;
        apiKey?: string;
      })
    : null;
  return {
    ...value,
    apiKey:
      credentials?.protocol === value.protocol &&
      credentials.baseUrl === value.baseUrl &&
      typeof credentials.apiKey === "string"
        ? credentials.apiKey
        : "",
  };
}

// Write the inactive credential slot first; publishing its reference is the commit.
// An interrupted save cannot replace the key referenced by the previous settings.
let pendingSave: Promise<void> = Promise.resolve();
export function saveProviderConfig(config: ProviderConfigDraft): Promise<void> {
  const save = pendingSave.then(async () => {
    const raw = await AsyncStorage.getItem(settingsKey);
    const activeSlot = raw ? parseSettings(raw).credentialSlot : undefined;
    const nextSlot: CredentialSlot = activeSlot === "a" ? "b" : "a";
    const { apiKey, ...settings } = config;
    await SecureStore.setItemAsync(
      credentialKey(nextSlot),
      JSON.stringify({
        protocol: config.protocol,
        baseUrl: config.baseUrl,
        apiKey,
      }),
    );
    await AsyncStorage.setItem(
      settingsKey,
      JSON.stringify({ ...settings, credentialSlot: nextSlot }),
    );
    const saved = await readSaved();
    if (
      !saved ||
      saved.name !== config.name ||
      saved.protocol !== config.protocol ||
      saved.baseUrl !== config.baseUrl ||
      saved.apiKey !== config.apiKey ||
      saved.model !== config.model ||
      JSON.stringify(saved.models) !== JSON.stringify(config.models)
    )
      throw new Error("无法验证已保存的供应商配置。");
    // Do not retain a superseded key after a successful replacement or reset.
    // Cleanup failures do not undo the committed settings and can be retried by
    // a later save; the original P0 migration records are never removed here.
    await Promise.allSettled([
      SecureStore.deleteItemAsync(credentialKey(activeSlot)),
      ...(activeSlot ? [SecureStore.deleteItemAsync(secretKey)] : []),
    ]);
    listeners.forEach((listener) => listener());
  });
  pendingSave = save.catch(() => {});
  return save;
}
async function loadProviderConfigOnce(): Promise<ProviderConfigDraft> {
  const existing = await readSaved();
  const migration = await AsyncStorage.getItem(migrationKey);
  if (migration === "1") return existing ?? defaultProvider;
  if (!existing || migration === "pending") {
    await AsyncStorage.setItem(migrationKey, "pending");
    const old = await loadNativeConfig();
    const models = parseProviderModels(old.providerModels);
    const model = old.providerModel.trim();
    if (model && !models.includes(model)) models.push(model);
    await saveProviderConfig({
      name: "自定义供应商",
      protocol: old.providerProtocol,
      baseUrl: old.providerBaseUrl,
      apiKey: old.providerKey,
      models,
      model: model || models[0] || "",
    });
  }
  const result = await readSaved();
  if (!result) throw new Error("供应商配置迁移失败，请重试。");
  await AsyncStorage.setItem(migrationKey, "1");
  return result;
}

let loading: Promise<ProviderConfigDraft> | undefined;
export function loadProviderConfig(): Promise<ProviderConfigDraft> {
  if (!loading) {
    loading = loadProviderConfigOnce().finally(() => {
      loading = undefined;
    });
  }
  return loading;
}
