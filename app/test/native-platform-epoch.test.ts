import { beforeEach, expect, it, vi } from "vitest";
const capture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../mobile/node_modules/expo/build/winter/fetch/index.js", () => ({
  fetch: capture.request,
}));
vi.mock("../../mobile/node_modules/expo-crypto", () => ({
  randomUUID: () => "id",
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
import { createNativePlatform } from "../../mobile/src/lib/native-platform";
import { defaultNativeConfig } from "../../mobile/src/lib/native-config";
beforeEach(() => capture.request.mockReset());

it("rejects a stale connection and never starts a request after authentication changes", async () => {
  let current = true;
  const platform = createNativePlatform(
    { ...defaultNativeConfig, serverUrl: "https://backend" },
    async () => "token",
    undefined,
    () => current,
  );
  const connection = await platform.connection();
  current = false;
  await expect(
    platform.request(`${connection.baseUrl}/api/agents`, {
      headers: connection.headers,
    }),
  ).rejects.toThrow("认证配置已更改");
  expect(capture.request).not.toHaveBeenCalled();
});

it("discards a token that resolves after the authentication configuration changes", async () => {
  let current = true;
  let resolveToken!: (value: string) => void;
  const platform = createNativePlatform(
    { ...defaultNativeConfig, serverUrl: "https://backend" },
    () =>
      new Promise((resolve) => {
        resolveToken = resolve;
      }),
    undefined,
    () => current,
  );
  const connection = platform.connection();
  current = false;
  resolveToken("old-token");
  await expect(connection).rejects.toThrow("认证配置已更改");
});

it("uses the configured transport while the authentication generation is current", async () => {
  capture.request.mockResolvedValueOnce(new Response("ok"));
  const platform = createNativePlatform(
    { ...defaultNativeConfig, serverUrl: "https://backend" },
    async () => "token",
    undefined,
    () => true,
  );
  const connection = await platform.connection();
  expect(
    (
      await platform.request(`${connection.baseUrl}/health`, {
        headers: connection.headers,
      })
    ).status,
  ).toBe(200);
  expect(capture.request).toHaveBeenCalledWith(
    "https://backend/health",
    expect.any(Object),
  );
});

it("ignores an old unauthorized response after the configuration changes", async () => {
  let current = true;
  let complete!: (response: Response) => void;
  capture.request.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const unauthorized = vi.fn();
  const platform = createNativePlatform(
    { ...defaultNativeConfig, serverUrl: "https://backend" },
    async () => "token",
    unauthorized,
    () => current,
  );
  const request = platform.request("https://backend/api/agents", {});
  current = false;
  complete(new Response("", { status: 401 }));
  await expect(request).rejects.toThrow("认证配置已更改");
  expect(unauthorized).not.toHaveBeenCalled();
});
