import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});

const projectRoot = fileURLToPath(new URL("../../../..", import.meta.url));

describe("backend workspace configuration", () => {
  it.each([
    ["true", true],
    ["false", false],
    ["1", false],
    ["TRUE", false],
    [undefined, false],
  ])(
    "enables scheduled scripts only for the explicit true setting (%s)",
    async (value, expected) => {
      vi.stubEnv("ANTLER_SCHEDULER_ENABLE_SCRIPT", value);
      const { config } = await import("../../src/config/env.js");
      expect(config.schedulerEnableScript).toBe(expected);
    },
  );
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves the default workspace from the project root", async () => {
    vi.stubEnv("ANTLER_WORKSPACE_ROOT", undefined);

    const { config } = await import("../../src/config/env.js");

    expect(config.workspaceRoot).toBe(resolve(projectRoot, "workspace"));
  });

  it("resolves a relative ANTLER_WORKSPACE_ROOT from the project root", async () => {
    vi.stubEnv("ANTLER_WORKSPACE_ROOT", "./custom-workspace");

    const { config } = await import("../../src/config/env.js");

    expect(config.workspaceRoot).toBe(resolve(projectRoot, "custom-workspace"));
  });

  it("reads the default RAG URL and key from the backend environment", async () => {
    vi.stubEnv("ANTLER_RAG_URL", "https://rag.example.com");
    vi.stubEnv("ANTLER_RAG_KEY", "test-rag-key");
    const { config } = await import("../../src/config/env.js");
    expect(config.ragUrl).toBe("https://rag.example.com");
    expect(config.ragKey).toBe("test-rag-key");
  });
});

describe("conversation storage configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to local storage and rejects unknown modes", async () => {
    vi.stubEnv("ANTLER_CONVERSATION_STORAGE", undefined);
    const { config, parseConversationStorage } = await import(
      "../../src/config/env.js"
    );
    expect(config.conversationStorage ?? "local").toBe("local");
    expect(parseConversationStorage("cos")).toBe("cos");
    expect(() => parseConversationStorage("s3")).toThrow(
      "ANTLER_CONVERSATION_STORAGE 无效",
    );
  });

  it("omits the COS config unless every required variable is present", async () => {
    vi.stubEnv("COS_SECRET_ID", "id");
    vi.stubEnv("COS_SECRET_KEY", "key");
    vi.stubEnv("COS_REGION", undefined);
    vi.stubEnv("COS_BUCKET", undefined);
    const { config } = await import("../../src/config/env.js");
    expect(config.cos).toBeUndefined();
  });

  it("builds the COS config from complete environment variables", async () => {
    vi.stubEnv("COS_SECRET_ID", "id");
    vi.stubEnv("COS_SECRET_KEY", "key");
    vi.stubEnv("COS_REGION", "ap-guangzhou");
    vi.stubEnv("COS_BUCKET", "bucket-1250000000");
    vi.stubEnv("COS_TOKEN", "token");
    vi.stubEnv("ANTLER_COS_PREFIX", "custom/prefix");
    const { config } = await import("../../src/config/env.js");
    expect(config.cos).toMatchObject({
      secretId: "id",
      secretKey: "key",
      region: "ap-guangzhou",
      bucket: "bucket-1250000000",
      token: "token",
      scheme: "https",
    });
    expect(config.cosPrefix).toBe("custom/prefix");
  });

  it("fails startup in cos mode without the required COS variables", async () => {
    const { validateConversationStorageConfig } = await import(
      "../../src/config/env.js"
    );
    expect(() =>
      validateConversationStorageConfig({
        host: "127.0.0.1",
        port: 0,
        provider: "openai",
        model: "test",
        workspaceRoot: "/tmp",
        maxRunDurationMs: 1000,
        conversationStorage: "cos",
      }),
    ).toThrow("ANTLER_CONVERSATION_STORAGE=cos 需要");
    expect(() =>
      validateConversationStorageConfig({
        host: "127.0.0.1",
        port: 0,
        provider: "openai",
        model: "test",
        workspaceRoot: "/tmp",
        maxRunDurationMs: 1000,
        conversationStorage: "local",
      }),
    ).not.toThrow();
  });
});
