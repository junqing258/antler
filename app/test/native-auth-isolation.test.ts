import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  clients: [] as any[],
  data: new Map<string, string>(),
  failRemove: false,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((url, key, options) => {
    const auth = {
      stopAutoRefresh: vi.fn(),
      dispose: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      onAuthStateChange: vi.fn((callback: (event: string) => void) => {
        auth.callback = callback;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      }),
      unsubscribe: vi.fn(),
      callback: undefined as ((event: string) => void) | undefined,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    };
    mocks.clients.push({ url, key, options, auth });
    return { auth };
  }),
}));
vi.mock(
  "../../mobile/node_modules/@react-native-async-storage/async-storage",
  () => ({
    default: {
      getItem: async (key: string) => mocks.data.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        mocks.data.set(key, value);
      },
      removeItem: async (key: string) => {
        if (mocks.failRemove) throw new Error("cleanup failed");
        mocks.data.delete(key);
      },
    },
  }),
);

beforeEach(() => {
  vi.resetModules();
  mocks.clients.length = 0;
  mocks.data.clear();
  mocks.failRemove = false;
});
it("isolates projects and recreates clients for key changes without discarding project storage", async () => {
  const { currentAccessToken, signOut } =
    await import("../../mobile/src/lib/native-auth");
  await currentAccessToken("https://auth.example/project-a/", "key-a");
  const first = mocks.clients[0];
  await currentAccessToken("https://auth.example/project-a", "key-b");
  const second = mocks.clients[1];
  expect(first.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  expect(first.auth.dispose).toHaveBeenCalledOnce();
  expect(first.options.auth.storageKey).toBe(second.options.auth.storageKey);
  await currentAccessToken("https://auth.example/project-b", "key-b");
  const third = mocks.clients[2];
  expect(third.options.auth.storageKey).not.toBe(
    second.options.auth.storageKey,
  );
  await signOut("https://auth.example/project-b", "key-b");
  expect(third.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("never reads the old unscoped session, and preserves a new session if old-key cleanup fails", async () => {
  const { currentAccessToken } = await import("../../mobile/src/lib/native-auth");
  mocks.data.set("antler.native.supabase.auth", "old-token");
  await currentAccessToken("https://auth.example/project-a", "key-a");
  const { storage, storageKey } = mocks.clients[0].options.auth;
  expect(await storage.getItem(storageKey)).toBeNull();
  await storage.setItem(`${storageKey}-code-verifier`, '"verifier"');
  expect(mocks.data.get("antler.native.supabase.auth")).toBe("old-token");
  await storage.setItem(storageKey, "{}");
  expect(mocks.data.get("antler.native.supabase.auth")).toBe("old-token");
  const newSession = JSON.stringify({
    access_token: "new-token",
    refresh_token: "new-refresh",
  });
  mocks.failRemove = true;
  await storage.setItem(storageKey, newSession);
  expect(mocks.data.get(storageKey)).toBe(newSession);
  expect(mocks.data.get("antler.native.supabase.auth")).toBe("old-token");
  mocks.failRemove = false;
  expect(await storage.getItem(storageKey)).toBe(newSession);
  expect(mocks.data.get(storageKey)).toBe(newSession);
  expect(mocks.data.has("antler.native.supabase.auth")).toBe(false);
});

it("surfaces sign-out failures instead of claiming the session was removed", async () => {
  const { currentAccessToken, signOut } =
    await import("../../mobile/src/lib/native-auth");
  await currentAccessToken("https://auth.example/project-a", "key-a");
  mocks.clients[0].auth.signOut.mockResolvedValue({
    error: new Error("storage unavailable"),
  });
  await expect(
    signOut("https://auth.example/project-a", "key-a"),
  ).rejects.toThrow("storage unavailable");
});

it("detaches old auth listeners before switching projects", async () => {
  const { currentAccessToken, onNativeSignedOut } =
    await import("../../mobile/src/lib/native-auth");
  const signedOut = vi.fn();
  const unsubscribe = onNativeSignedOut(
    "https://auth.example/project-a",
    "key-a",
    signedOut,
  );
  const old = mocks.clients[0];
  await currentAccessToken("https://auth.example/project-b", "key-b");
  expect(old.auth.unsubscribe).toHaveBeenCalledOnce();
  old.auth.callback("SIGNED_OUT");
  expect(signedOut).not.toHaveBeenCalled();
  unsubscribe();
});

it("rejects an in-flight old project token when the project changes", async () => {
  const { currentAccessToken, onNativeSignedOut } =
    await import("../../mobile/src/lib/native-auth");
  onNativeSignedOut("https://auth.example/project-a", "key-a", () => {});
  let resolveOld!: (value: unknown) => void;
  mocks.clients[0].auth.getSession.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const pending = currentAccessToken("https://auth.example/project-a", "key-a");
  const rejected = expect(pending).rejects.toThrow("认证配置已更改");
  await currentAccessToken("https://auth.example/project-b", "key-b");
  resolveOld({ data: { session: { access_token: "old-project-token" } } });
  await rejected;
});

it("invalidates an in-flight token read when authentication is deactivated", async () => {
  const { currentAccessToken, disposeNativeAuth, onNativeSignedOut } =
    await import("../../mobile/src/lib/native-auth");
  onNativeSignedOut("https://auth.example/project-a", "key-a", () => {});
  const old = mocks.clients[0];
  let resolveOld!: (value: unknown) => void;
  old.auth.getSession.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const pending = currentAccessToken("https://auth.example/project-a", "key-a");
  const rejected = expect(pending).rejects.toThrow("认证配置已更改");
  disposeNativeAuth();
  resolveOld({ data: { session: { access_token: "stale-token" } } });
  await rejected;
  expect(old.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  expect(old.auth.unsubscribe).toHaveBeenCalledOnce();
});

it("does not confuse projects when URL and key contain separator characters", async () => {
  const { currentAccessToken } = await import("../../mobile/src/lib/native-auth");
  await currentAccessToken("https://auth.example/a|b", "c");
  await currentAccessToken("https://auth.example/a", "b|c");
  expect(mocks.clients).toHaveLength(2);
  expect(mocks.clients[0].options.auth.storageKey).not.toBe(
    mocks.clients[1].options.auth.storageKey,
  );
});
