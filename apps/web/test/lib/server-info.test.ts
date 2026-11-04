import { afterEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getSession } })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("browser server info", () => {
  it.each([
    [true, "http://127.0.0.1:3210"],
    [false, ""],
  ])("resolves the default API URL with DEV=%s", async (dev, baseUrl) => {
    vi.stubEnv("DEV", dev);
    vi.stubEnv("VITE_ANTLER_SERVER_BASE_URL", undefined);
    vi.stubEnv("VITE_ANTLER_ACCESS_TOKEN", undefined);
    const { serverInfo } = await import("@/lib/server-info");
    await expect(serverInfo()).resolves.toEqual({ baseUrl, token: "" });
  });

  it("uses the configured backend URL and local access token", async () => {
    vi.stubEnv("VITE_ANTLER_SERVER_BASE_URL", "https://api.example.com");
    vi.stubEnv("VITE_ANTLER_ACCESS_TOKEN", "local-token");
    const { serverInfo } = await import("@/lib/server-info");
    await expect(serverInfo()).resolves.toEqual({
      baseUrl: "https://api.example.com",
      token: "local-token",
    });
  });

  it("uses the current Supabase session token after loading auth config", async () => {
    vi.stubEnv("VITE_ANTLER_SERVER_BASE_URL", "https://api.example.com");
    vi.stubEnv("VITE_ANTLER_ACCESS_TOKEN", "local-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "supabase",
          url: "https://example.supabase.co",
          publishableKey: "publishable-key",
        }),
      }),
    );
    getSession.mockResolvedValue({
      data: { session: { access_token: "session-token" } },
    });
    const { loadAuthConfig, serverInfo } = await import("@/lib/server-info");
    await loadAuthConfig();
    await expect(serverInfo()).resolves.toEqual({
      baseUrl: "https://api.example.com",
      token: "session-token",
    });
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(serverInfo()).resolves.toEqual({
      baseUrl: "https://api.example.com",
      token: "",
    });
  });
});
