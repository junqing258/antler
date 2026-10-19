import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED, SecretGuard } from "../../src/agent/secret-guard.js";
import * as protectedEnv from "../../src/config/protected-env.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SecretGuard", () => {
  it("preserves email addresses when public server settings contain digits or SMTP addresses", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-public-env-"));
    roots.push(root);
    const path = join(root, ".env");
    const address = "junqing258@126.com";
    await writeFile(
      path,
      [
        "ANTLER_TRACE_SAMPLE_RATIO=1",
        "CUSTOM_RETRY_COUNT=2",
        "ANTLER_AUTH_MODE=local",
        "ANTLER_SMTP_PORT=465",
        `ANTLER_SMTP_FROM=${address}`,
        `ANTLER_SMTP_USER=${address}`,
        "ANTLER_SMTP_PASS=test-smtp-password",
      ].join("\n"),
    );
    vi.spyOn(protectedEnv, "getProtectedEnvFiles").mockReturnValue([path]);
    vi.stubEnv("ANTLER_TRACE_SAMPLE_RATIO", "0");
    const guard = new SecretGuard(root);
    await guard.refresh();
    guard.captureEnvironment();
    const input = `发个测试邮件到 ${address}，另一个地址 user@163.com，采样 0/1/2 local`;
    expect(guard.redact(input)).toBe(input);
    expect(guard.sanitize({ to: address })).toEqual({ to: address });
    const stream = guard.stream();
    expect(
      [...input].map((char) => stream.push(char)).join("") + stream.finish(),
    ).toBe(input);
    expect(guard.redact("test-smtp-password")).toBe(REDACTED);
    expect(guard.toolEnvironment().ANTLER_SMTP_PASS).toBeUndefined();
  });

  it("filters all server dotenv variables from subprocesses but only redacts credential values", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-server-env-"));
    roots.push(root);
    const path = join(root, ".env");
    await writeFile(
      path,
      "CUSTOM_VALUE=ordinary-setting\nCUSTOM_SECRET=file-private-value\n",
    );
    vi.spyOn(protectedEnv, "getProtectedEnvFiles").mockReturnValue([path]);
    vi.stubEnv("CUSTOM_VALUE", "ordinary-override");
    vi.stubEnv("CUSTOM_SECRET", "overridden-private-value");
    const guard = new SecretGuard();
    await guard.refresh();
    expect(guard.toolEnvironment().CUSTOM_VALUE).toBeUndefined();
    expect(guard.toolEnvironment().CUSTOM_SECRET).toBeUndefined();
    expect(guard.redact("ordinary-setting ordinary-override")).toBe(
      "ordinary-setting ordinary-override",
    );
    expect(guard.redact("file-private-value overridden-private-value")).toBe(
      `${REDACTED} ${REDACTED}`,
    );
  });
  it("collects credential fields from nested dotenv files, including quoted multiline values", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-guard-"));
    roots.push(root);
    await mkdir(join(root, "nested"));
    await writeFile(
      join(root, ".env"),
      'export CUSTOM_SECRET="private value # retained"\nMULTILINE_TOKEN="first line\nsecond line"\n',
    );
    await writeFile(
      join(root, "nested", ".env.production"),
      "NESTED_PASSWORD=nested-private-value\n",
    );
    const guard = new SecretGuard(root);
    await guard.refresh();
    expect(
      guard.redact(
        "private value # retained / first line\nsecond line / nested-private-value",
      ),
    ).toBe(`${REDACTED} / ${REDACTED} / ${REDACTED}`);
  });

  it("redacts raw, encoded and nested secrets without changing input objects", () => {
    const secret = 'private/key+with"quote';
    const guard = new SecretGuard(undefined, undefined, [secret]);
    const values = [
      secret,
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("hex"),
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
    ];
    const input = {
      content: values.map((text) => ({ text })),
      details: { [secret]: secret },
    };
    expect(guard.sanitize(input)).toEqual({
      content: values.map(() => ({ text: REDACTED })),
      details: { [REDACTED]: REDACTED },
    });
    expect(input.content[0].text).toBe(secret);
  });

  it("protects short secrets and overlapping secrets without corrupting redaction markers", () => {
    const guard = new SecretGuard(undefined, undefined, ["x", "xyz", "RED"]);
    expect(guard.redact("xyz x RED")).toBe(
      `${REDACTED} ${REDACTED} ${REDACTED}`,
    );
    expect(guard.redact(REDACTED)).toBe(REDACTED);
    const stream = guard.stream();
    expect(stream.push("x")).toBe("");
    expect(stream.push("yz!")).toBe(`${REDACTED}!`);
    const shortGuard = new SecretGuard(undefined, undefined, ["t"]);
    expect(
      shortGuard.sanitize({ content: [{ type: "text", text: "t" }] }),
    ).toEqual({ content: [{ type: "text", text: REDACTED }] });
  });

  it("holds secrets across every possible chunk boundary", () => {
    const secret = "super-private-api-key-12345";
    const guard = new SecretGuard(undefined, undefined, [secret]);
    for (const value of [secret, Buffer.from(secret).toString("base64")]) {
      for (let split = 1; split < value.length; split++) {
        const stream = guard.stream();
        expect(stream.push(`Before: ${value.slice(0, split)}`)).toBe(
          "Before: ",
        );
        expect(stream.push(`${value.slice(split)}!`)).toBe(`${REDACTED}!`);
        expect(stream.finish()).toBe("");
      }
    }
    const stream = guard.stream();
    expect(stream.push(secret.slice(0, 10))).toBe("");
    expect(stream.finish()).toBe(REDACTED);
  });

  it("removes server credentials while retaining explicit skill credentials and their old values for redaction", () => {
    vi.stubEnv("OPENAI_API_KEY", "server-private-key");
    vi.stubEnv("ANTLER_SMTP_PASS", "server-smtp-password");
    vi.stubEnv("DIRECT_URL", "postgres://user:password@db.example/test");
    vi.stubEnv("ANTLER_TEST_SETTING", "normal-setting");
    let key = "skill-old-private-key";
    const guard = new SecretGuard(undefined, () => ({ ANTLER_RAG_KEY: key }));
    expect(guard.toolEnvironment()).toEqual(
      expect.objectContaining({
        ANTLER_TEST_SETTING: "normal-setting",
        ANTLER_RAG_KEY: key,
      }),
    );
    expect(guard.toolEnvironment().OPENAI_API_KEY).toBeUndefined();
    expect(guard.toolEnvironment().ANTLER_SMTP_PASS).toBeUndefined();
    expect(guard.toolEnvironment().DIRECT_URL).toBeUndefined();
    expect(
      guard.redact("server-smtp-password postgres://user:password@db.example/test"),
    ).toBe(`${REDACTED} ${REDACTED}`);
    key = "skill-new-private-key";
    guard.captureEnvironment();
    expect(
      guard.redact(
        "server-private-key skill-old-private-key skill-new-private-key",
      ),
    ).toBe(`${REDACTED} ${REDACTED} ${REDACTED}`);
  });
});
