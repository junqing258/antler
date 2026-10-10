import { beforeEach, describe, expect, it } from "vitest";
import {
  loadProviderConfig,
  getModelPickerConfig,
  PROVIDER_CONFIG_STORAGE_KEY,
  saveProviderConfig,
  type ProviderConfig,
} from "../../src/lib/provider-config";

const config: ProviderConfig = {
  name: "Test provider",
  protocol: "openai-responses",
  baseUrl: "https://example.com/v1",
  apiKey: "test-key",
  models: ["gpt-4.1-mini", "gpt-5-mini"],
  model: "gpt-5-mini",
};

describe("provider config", () => {
  beforeEach(() => localStorage.clear());

  it("starts without a hard-coded model and persists the empty configuration", () => {
    const defaults = loadProviderConfig();
    expect(defaults).toMatchObject({ model: "", models: [] });
    saveProviderConfig({ ...defaults, name: "Custom" });
    expect(loadProviderConfig()).toEqual({ ...defaults, name: "Custom" });
  });

  it.each([undefined, "", "   "])("selects the first configured model when the selection is %j", (model) => {
    localStorage.setItem(PROVIDER_CONFIG_STORAGE_KEY, JSON.stringify({
      ...config,
      model,
      models: [" ", " custom-model ", "custom-model", "other-model"],
    }));
    expect(loadProviderConfig()).toMatchObject({
      model: "custom-model",
      models: ["custom-model", "other-model"],
    });
  });

  it("migrates single-model configurations", () => {
    localStorage.setItem(PROVIDER_CONFIG_STORAGE_KEY, JSON.stringify({
      ...config,
      models: undefined,
    }));
    expect(loadProviderConfig()).toMatchObject({
      model: config.model,
      models: [config.model],
    });
  });

  it("shows the server model when requests use server credentials", () => {
    expect(getModelPickerConfig({ ...config, apiKey: " " }, "server-model"))
      .toEqual({ model: "server-model", models: [] });
    expect(getModelPickerConfig(config, "server-model"))
      .toEqual({ model: config.model, models: config.models });
  });

  it("persists the selected model", () => {
    saveProviderConfig(config);

    expect(loadProviderConfig()).toEqual(config);
  });

  it("keeps the selected model available when normalizing older configs", () => {
    localStorage.setItem(
      PROVIDER_CONFIG_STORAGE_KEY,
      JSON.stringify({
        ...config,
        models: [" gpt-4.1-mini ", "gpt-4.1-mini"],
      }),
    );

    expect(loadProviderConfig()).toMatchObject({
      model: "gpt-5-mini",
      models: ["gpt-4.1-mini", "gpt-5-mini"],
    });
  });
});
