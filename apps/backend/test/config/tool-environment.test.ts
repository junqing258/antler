import { describe, expect, it } from "vitest";
import { skillEnvironment } from "../../src/config/tool-environment.js";
import { REDACTED, SecretGuard } from "../../src/agent/secret-guard.js";

describe("shell skill environment", () => {
  it("injects supported skill credentials and COS settings without exposing server credentials", () => {
    const environment = {
      TUSHARE_TOKEN: "test-stock-token",
      TAVILY_API_KEY: "test-search-key",
      SERPAPI_KEY: "test-serp-key",
      COS_SECRET_ID: "test-cos-id",
      COS_SECRET_KEY: "test-cos-key",
      COS_TOKEN: "test-cos-token",
      COS_REGION: "ap-shanghai",
      COS_BUCKET: "reports-123",
      COS_APP_ID: "123",
      COS_SCHEME: "https",
      COS_ENDPOINT: "cos.example.com",
    };
    const injected = skillEnvironment({
      ...environment,
      OPENAI_API_KEY: "model-secret",
      ANTHROPIC_AUTH_TOKEN: "model-secret-2",
      ANTLER_SMTP_PASS: "smtp-secret",
      DATABASE_URL: "database-secret",
      REDIS_URL: "redis-secret",
      ANTLER_ACCESS_TOKEN: "access-secret",
      UNKNOWN_API_KEY: "unknown-secret",
    });
    expect(injected).toEqual(environment);
    const guard = new SecretGuard(undefined, () => injected);
    expect(guard.toolEnvironment()).toEqual(expect.objectContaining(environment));
    for (const name of ["TUSHARE_TOKEN", "TAVILY_API_KEY", "SERPAPI_KEY", "COS_SECRET_ID", "COS_SECRET_KEY", "COS_TOKEN"] as const) {
      expect(guard.redact(environment[name])).toBe(REDACTED);
    }
    expect(guard.redact(environment.COS_REGION)).toBe(environment.COS_REGION);
  });

  it("omits missing and empty values", () => {
    expect(skillEnvironment({ TUSHARE_TOKEN: "", COS_SECRET_KEY: undefined })).toEqual({});
  });
});
