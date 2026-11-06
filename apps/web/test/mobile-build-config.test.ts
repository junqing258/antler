/// <reference types="node" />
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const path = require.resolve("../../mobile/app.config.js");
const original = { ...process.env };
function loadConfig() {
  delete require.cache[path];
  return require(path);
}
afterEach(() => {
  process.env = { ...original };
});
it("keeps release HTTPS-only and disables automation even if requested", () => {
  process.env.ANTLER_MOBILE_ENV = "production";
  process.env.ANTLER_MOBILE_AUTOMATION = "true";
  process.env.EXPO_PUBLIC_ANTLER_SERVER_URL = "https://api.example";
  const config = loadConfig();
  expect(config.name).toBe("Antler");
  expect(config.extra).toMatchObject({
    serverUrl: "https://api.example",
    allowHttp: false,
    automationEnabled: false,
  });
  expect(
    config.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking,
  ).toBe(false);
  expect(
    config.ios.infoPlist.NSAppTransportSecurity.NSExceptionDomains,
  ).toBeUndefined();
  expect(config.plugins.at(-1)[1].allowHttp).toBe(false);
});
it("limits development HTTP exceptions to the configured host", () => {
  process.env.ANTLER_MOBILE_ENV = "test";
  process.env.ANTLER_MOBILE_AUTOMATION = "true";
  process.env.EXPO_PUBLIC_ANTLER_SERVER_URL = "http://dev.example:3210";
  const config = loadConfig();
  expect(config.extra.automationEnabled).toBe(true);
  expect(
    Object.keys(config.ios.infoPlist.NSAppTransportSecurity.NSExceptionDomains),
  ).toEqual(["dev.example"]);
  expect(config.plugins.at(-1)[1].allowHttp).toBe(true);
});
it("rejects unknown build environments", () => {
  process.env.ANTLER_MOBILE_ENV = "prod";
  expect(loadConfig).toThrow("Invalid ANTLER_MOBILE_ENV");
});

it("rejects secrets in URLs and HTTP in production before they are bundled", () => {
  process.env.ANTLER_MOBILE_ENV = "production";
  for (const url of [
    "http://api.example",
    "https://user:password@api.example",
    "https://api.example/?token=secret",
  ]) {
    process.env.EXPO_PUBLIC_ANTLER_SERVER_URL = url;
    expect(loadConfig).toThrow("Invalid mobile backend URL");
  }
});

it("uses the confirmed public production endpoint by default", () => {
  process.env.ANTLER_MOBILE_ENV = "production";
  delete process.env.EXPO_PUBLIC_ANTLER_SERVER_URL;
  expect(loadConfig().extra.serverUrl).toBe("https://chat.xiaoanai.top");
});
