import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

beforeEach(() => {
  vi.resetModules();
  mocks.createClient.mockReset();
  mocks.createClient.mockImplementation(() => ({ auth: {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("password recovery client", () => {
  it("uses a separate non-persistent client without replacing the main session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      mode: "supabase",
      url: "https://auth.example.com",
      publishableKey: "test-public-key",
    })));
    const { loadAuthConfig, supabaseClient, createPasswordRecoveryClient } =
      await import("@/lib/server-info");
    expect(createPasswordRecoveryClient()).toBeUndefined();
    await loadAuthConfig();
    const main = supabaseClient();
    const recovery = createPasswordRecoveryClient();
    expect(recovery).not.toBe(main);
    expect(supabaseClient()).toBe(main);
    expect(mocks.createClient).toHaveBeenLastCalledWith(
      "https://auth.example.com",
      "test-public-key",
      { auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "antler-password-recovery",
      } },
    );
    expect(createPasswordRecoveryClient()).not.toBe(recovery);
  });

  it("does not create a recovery client in local mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ mode: "local" })));
    const { loadAuthConfig, createPasswordRecoveryClient } = await import("@/lib/server-info");
    await loadAuthConfig();
    expect(createPasswordRecoveryClient()).toBeUndefined();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
