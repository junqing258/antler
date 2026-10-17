import { afterEach, describe, expect, it, vi } from "vitest";

function stubAuthConfig(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("loadAuthConfig / authHeaders", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("supabase 配置下发后 authHeaders 返回 Bearer 头", async () => {
    stubAuthConfig({
      mode: "supabase",
      url: "https://example.supabase.co",
      publishableKey: "publishable-key",
    });
    const { loadAuthConfig, authHeaders } = await import("@/lib/server-info");
    await expect(loadAuthConfig()).resolves.toBe("supabase");
    expect(authHeaders({ baseUrl: "", token: "access-token" })).toEqual({
      authorization: "Bearer access-token",
    });
  });

  it("local 模式（含配置缺失）返回共享令牌头", async () => {
    stubAuthConfig({ mode: "local" });
    const { loadAuthConfig, authHeaders } = await import("@/lib/server-info");
    await expect(loadAuthConfig()).resolves.toBe("local");
    expect(authHeaders({ baseUrl: "", token: "shared-token" })).toEqual({
      "x-antler-token": "shared-token",
    });
  });

  it("后端不可达时按 local 模式降级", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const { loadAuthConfig, authHeaders } = await import("@/lib/server-info");
    await expect(loadAuthConfig()).resolves.toBe("local");
    expect(authHeaders({ baseUrl: "", token: "shared-token" })).toEqual({
      "x-antler-token": "shared-token",
    });
  });
});
