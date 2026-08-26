import { beforeEach, describe, expect, it } from "vitest";
import {
  loadProviderConfig,
  PROVIDER_CONFIG_STORAGE_KEY,
  saveProviderConfig,
  type ProviderConfig,
} from "./provider-config";

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
