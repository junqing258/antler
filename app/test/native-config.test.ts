import { expect, it } from "vitest";
import {
  defaultNativeConfig,
  deserializeNativeConfig,
  serializeNativeConfig,
  validateServerUrl,
} from "../../mobile/src/native-config";

it("stores secrets separately and never restores them to a different endpoint or auth mode", () => {
  const config = {
    ...defaultNativeConfig,
    serverUrl: "https://server.test",
    authMode: "supabase" as const,
    accessToken: "token-secret",
    providerProtocol: "anthropic-messages" as const,
    providerBaseUrl: "https://provider.test",
    providerKey: "model-secret",
  };
  const { settings, secrets } = serializeNativeConfig(config);
  expect(settings).not.toContain("token-secret");
  expect(settings).not.toContain("model-secret");
  expect(deserializeNativeConfig(settings, secrets)).toEqual(config);
  const altered = JSON.stringify({
    ...JSON.parse(settings),
    serverUrl: "https://different.test",
    providerBaseUrl: "https://other.test",
  });
  expect(deserializeNativeConfig(altered, secrets)).toMatchObject({
    accessToken: "",
    providerKey: "",
  });
  expect(
    deserializeNativeConfig(
      JSON.stringify({ ...JSON.parse(settings), authMode: "local" }),
      secrets,
    ).accessToken,
  ).toBe("");
});

it("rejects corrupt configuration and production HTTP or URLs containing credentials", () => {
  expect(() => deserializeNativeConfig('{"serverUrl":42}', null)).toThrow();
  expect(() => validateServerUrl("http://server.test", false)).toThrow();
  expect(validateServerUrl("http://server.test/", true)).toBe(
    "http://server.test",
  );
  expect(() =>
    validateServerUrl("https://user:password@server.test", false),
  ).toThrow();
});
