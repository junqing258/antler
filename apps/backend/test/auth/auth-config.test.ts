import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { parseAuthMode, type AppConfig } from "../../src/config/env.js";

const base: AppConfig = {
  host: "127.0.0.1",
  port: 3210,
  provider: "openai",
  workspaceRoot: "/tmp/antler-auth-config-test",
  model: "test",
  maxRunDurationMs: 1000,
};

describe("public authentication configuration", () => {
  it("rejects unrecognized authentication modes rather than falling back to local", () => {
    expect(parseAuthMode(undefined)).toBe("local");
    expect(parseAuthMode("supabase")).toBe("supabase");
    expect(() => parseAuthMode("supabse")).toThrow(/ANTLER_AUTH_MODE/);
    expect(() => parseAuthMode("")).toThrow(/ANTLER_AUTH_MODE/);
    expect(() =>
      createApp({ ...base, authMode: "supabse" as AppConfig["authMode"] }),
    ).toThrow(/ANTLER_AUTH_MODE/);
  });
  it.each([
    { supabaseUrl: undefined, supabasePublishableKey: "key" },
    { supabaseUrl: "https://auth.example", supabasePublishableKey: undefined },
    { supabaseUrl: "not a url", supabasePublishableKey: "key" },
    { supabaseUrl: "https://auth.example ", supabasePublishableKey: "key" },
    { supabaseUrl: "https://auth.example", supabasePublishableKey: " key " },
  ])("rejects incomplete Supabase configuration", (settings) => {
    expect(() =>
      createApp({ ...base, authMode: "supabase", ...settings }),
    ).toThrow(/Supabase/);
  });
  it.each([undefined, "secret"])(
    "declares whether local access is protected",
    async (accessToken) => {
      const app = createApp({ ...base, authMode: "local", accessToken });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/api/auth-config",
        });
        expect(response.json()).toEqual({
          mode: "local",
          requiresAccessToken: Boolean(accessToken),
        });
        expect(response.body).not.toContain("secret");
      } finally {
        await app.close();
      }
    },
  );
});
