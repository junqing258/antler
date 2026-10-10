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
  it("protects every variable from server-loaded environment files, even without a sensitive name", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-server-env-"));
    roots.push(root);
    const path = join(root, ".env");
    await writeFile(path, "CUSTOM_VALUE=file-private-value\n");
    vi.spyOn(protectedEnv, "getProtectedEnvFiles").mockReturnValue([path]);
    vi.stubEnv("CUSTOM_VALUE", "overridden-private-value");
    const guard = new SecretGuard();
    await guard.refresh();
    expect(guard.toolEnvironment().CUSTOM_VALUE).toBeUndefined();
    expect(guard.redact("file-private-value overridden-private-value")).toBe(
      `${REDACTED} ${REDACTED}`,
    );
  });
  it("collects nested dotenv values, including quoted multiline and non-secret variable names", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-guard-"));
    roots.push(root);
    await mkdir(join(root, "nested"));
    await writeFile(
      join(root, ".env"),
      'export CUSTOM_VALUE="private value # retained"\nMULTILINE="first line\nsecond line"\n',
    );
    await writeFile(
      join(root, "nested", ".env.production"),
      "NESTED=nested-private-value\n",
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
    key = "skill-new-private-key";
    guard.captureEnvironment();
    expect(
      guard.redact(
        "server-private-key skill-old-private-key skill-new-private-key",
      ),
    ).toBe(`${REDACTED} ${REDACTED} ${REDACTED}`);
  });
});
