import { afterEach, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          error: { message: "Invalid login credentials" },
        }),
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
} from "../../mobile/src/native-auth";

afterEach(() => {
  vi.unstubAllGlobals();
  capture.clients.length = 0;
});

it("parses the backend auth config, falling back to local mode", async () => {
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
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ mode: "local" }))),
  );
  expect(await loadAuthBackendConfig("https://server.example")).toEqual({
    mode: "local",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("offline")),
  );
  expect(await loadAuthBackendConfig("https://server.example")).toEqual({
    mode: "local",
  });
});

it("translates rejected sign-in into a readable error and reads the session token", async () => {
  await expect(
    signIn("https://sb.example", "pk", "a@b.c", "wrong"),
  ).rejects.toThrow("邮箱或密码不正确。");
  expect(
    await currentAccessToken("https://sb.example", "pk"),
  ).toBe("");
});
