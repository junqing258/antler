import { afterEach, describe, expect, it, vi } from "vitest";

describe("authHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("Supabase 模式返回 Bearer 头", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const { authHeaders } = await import("@/lib/server-info");
    expect(authHeaders({ baseUrl: "", token: "access-token" })).toEqual({
      authorization: "Bearer access-token",
    });
  });

  it("本地模式返回共享令牌头", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", undefined);
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", undefined);
    const { authHeaders } = await import("@/lib/server-info");
    expect(authHeaders({ baseUrl: "", token: "shared-token" })).toEqual({
      "x-antler-token": "shared-token",
    });
  });
});
