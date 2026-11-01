import { beforeEach, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  secrets: new Map<string, string>(),
  failSettings: false,
}));
vi.mock(
  "../../mobile/node_modules/@react-native-async-storage/async-storage",
  () => ({
    default: {
      getItem: async (key: string) => stores.settings.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (key === "antler.provider.settings.v1" && stores.failSettings)
          throw new Error("disk failure");
        stores.settings.set(key, value);
      },
    },
  }),
);
vi.mock("../../mobile/node_modules/expo-secure-store", () => ({
  getItemAsync: async (key: string) => stores.secrets.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    stores.secrets.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    stores.secrets.delete(key);
  },
}));
vi.mock("../../mobile/src/native-storage", () => ({
  loadNativeConfig: async () => ({
    providerProtocol: "openai-responses",
    providerBaseUrl: "https://provider.example",
    providerModel: "model-b",
    providerModels: "model-a, model-a, model-b",
    providerKey: "secret",
  }),
}));
import {
  loadProviderConfig,
  saveProviderConfig,
  subscribeProviderConfig,
} from "../../mobile/src/provider-storage.native";

beforeEach(() => {
  stores.settings.clear();
  stores.secrets.clear();
  stores.failSettings = false;
});
it("retries interrupted migration without losing the selected model or key", async () => {
  stores.failSettings = true;
  await expect(loadProviderConfig()).rejects.toThrow();
  expect(stores.settings.get("antler.provider.migrated.v1")).toBe("pending");
  stores.failSettings = false;
  const config = await loadProviderConfig();
  expect(config).toMatchObject({
    name: "自定义供应商",
    apiKey: "secret",
    model: "model-b",
    models: ["model-a", "model-b"],
  });
  expect(await loadProviderConfig()).toEqual(config);
  expect(stores.settings.get("antler.provider.settings.v1")).not.toContain(
    "secret",
  );
});
it("publishes successful saves and never attaches a key to another endpoint", async () => {
  const config = await loadProviderConfig();
  const changed = vi.fn();
  const unsubscribe = subscribeProviderConfig(changed);
  await saveProviderConfig({ ...config, baseUrl: "https://new.example" });
  expect(changed).toHaveBeenCalledOnce();
  const saved = JSON.parse(stores.settings.get("antler.provider.settings.v1")!);
  stores.settings.set(
    "antler.provider.settings.v1",
    JSON.stringify({ ...saved, baseUrl: "https://other.example" }),
  );
  expect((await loadProviderConfig()).apiKey).toBe("");
  unsubscribe();
});

it("preserves the previous endpoint and key when saving the replacement fails", async () => {
  const previous = await loadProviderConfig();
  stores.failSettings = true;
  await expect(
    saveProviderConfig({
      ...previous,
      baseUrl: "https://replacement.example",
      apiKey: "replacement-key",
    }),
  ).rejects.toThrow("disk failure");
  stores.failSettings = false;
  expect(await loadProviderConfig()).toEqual(previous);
  await saveProviderConfig({
    ...previous,
    baseUrl: "https://replacement.example",
    apiKey: "replacement-key",
  });
  expect((await loadProviderConfig()).apiKey).toBe("replacement-key");
});

it("reads and upgrades the earlier single-credential format without losing its key", async () => {
  stores.settings.set("antler.provider.migrated.v1", "1");
  stores.settings.set(
    "antler.provider.settings.v1",
    JSON.stringify({
      name: "旧配置",
      protocol: "openai-responses",
      baseUrl: "https://old.example",
      models: ["m"],
      model: "m",
    }),
  );
  stores.secrets.set(
    "antler.provider.credentials.v1",
    JSON.stringify({
      protocol: "openai-responses",
      baseUrl: "https://old.example",
      apiKey: "old-key",
    }),
  );
  const previous = await loadProviderConfig();
  expect(previous.apiKey).toBe("old-key");
  await saveProviderConfig({ ...previous, name: "已更新" });
  expect(await loadProviderConfig()).toMatchObject({
    name: "已更新",
    apiKey: "old-key",
  });
});

it("removes the superseded credential after a successful reset", async () => {
  const config = await loadProviderConfig();
  const oldSlot = JSON.parse(
    stores.settings.get("antler.provider.settings.v1")!,
  ).credentialSlot;
  await saveProviderConfig({ ...config, apiKey: "" });
  expect(stores.secrets.has(`antler.provider.credentials.v1.${oldSlot}`)).toBe(
    false,
  );
  expect((await loadProviderConfig()).apiKey).toBe("");
});
