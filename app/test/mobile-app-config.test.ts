import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));
vi.mock("../../mobile/node_modules/expo-constants", () => ({ default: { expoConfig: { get extra() { return state.extra; } } } }));
import { readAppConfig } from "../../mobile/src/app-config";
it("validates the embedded endpoint and build policy", () => {
  state.extra = {};
  expect(readAppConfig).toThrow("未配置");
  state.extra = { serverUrl: "https://user:secret@api.example" };
  expect(readAppConfig).toThrow("无效");
  state.extra = { serverUrl: "http://api.example", allowHttp: false };
  expect(readAppConfig).toThrow("无效");
  state.extra = { serverUrl: "http://api.example/", allowHttp: true, automationEnabled: true };
  expect(readAppConfig()).toEqual({ serverUrl: "http://api.example", automationEnabled: true });
});
