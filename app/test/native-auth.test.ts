import { afterEach, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          error: { message: "Invalid login credentials" },
        }),
        stopAutoRefresh: vi.fn(),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { session: null }, error: null }),
      },
    };
    capture.clients.push(client);
    return client;
  }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import {
  currentAccessToken,
  loadAuthBackendConfig,
  signIn,
} from "../../mobile/src/lib/native-auth";

afterEach(() => {
  vi.unstubAllGlobals();
  capture.clients.length = 0;
});

it("requires an explicit valid backend authentication configuration", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "supabase",
          url: "https://sb.example",
          publishableKey: "pk",
        }),
      ),
    ),
  );
  expect(await loadAuthBackendConfig("https://server.example")).toEqual({
    mode: "supabase",
    url: "https://sb.example",
    publishableKey: "pk",
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ mode: "local", requiresAccessToken: false }),
        ),
      ),
  );
  expect(await loadAuthBackendConfig("https://server.example")).toEqual({
    mode: "local",
    requiresAccessToken: false,
  });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  await expect(
    loadAuthBackendConfig("https://server.example"),
  ).rejects.toThrow();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ mode: "local" }))),
  );
  await expect(loadAuthBackendConfig("https://server.example")).rejects.toThrow(
    "升级",
  );
});

it("reports HTTP failures and invalid JSON as errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("no", { status: 503 })),
  );
  await expect(loadAuthBackendConfig("https://server.example")).rejects.toThrow(
    "认证配置",
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json")));
  await expect(loadAuthBackendConfig("https://server.example")).rejects.toThrow(
    "认证配置无效",
  );
});

it("translates rejected sign-in into a readable error and reads the session token", async () => {
  await expect(
    signIn("https://sb.example", "pk", "a@b.c", "wrong"),
  ).rejects.toThrow("邮箱或密码不正确。");
  expect(await currentAccessToken("https://sb.example", "pk")).toBe("");
});

it("times out an unresponsive auth endpoint so startup can be retried", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      ),
    );
    const result = loadAuthBackendConfig("https://server.example");
    const assertion = expect(result).rejects.toThrow("检查网络后重试");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});
