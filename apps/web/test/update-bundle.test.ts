/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "antler-update-bundle-")));
  fixtures.push(root);
  const mobile = join(root, "mobile");
  const bin = join(root, "bin");
  mkdirSync(join(mobile, "scripts"), { recursive: true });
  mkdirSync(bin);
  const script = join(mobile, "scripts", "update-bundle.mjs");
  copyFileSync(resolve(import.meta.dirname, "../../mobile/scripts/update-bundle.mjs"), script);
  copyFileSync(resolve(import.meta.dirname, "../../mobile/app.config.js"), join(mobile, "app.config.js"));
  const nativeConfig = JSON.stringify({ expo: {
    version: "0.1.1", runtimeVersion: { policy: "appVersion" }, ios: {},
    extra: { eas: { projectId: "test-project" } },
  } });
  writeFileSync(join(mobile, "app.json"), nativeConfig);
  const packageConfig = '{"version":"0.1.1"}';
  writeFileSync(join(mobile, "package.json"), packageConfig);
  const versionFile = join(mobile, "bundle-version.json");
  writeFileSync(versionFile, '{"version":"0.1.9"}\n');
  const log = join(root, "invocation.json");
  writeFileSync(join(bin, "pnpm"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const config = require(path.join(process.cwd(), 'app.config.js'));
fs.writeFileSync(process.env.BUNDLE_TEST_LOG, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(),
  bundleVersion: config.extra.bundleVersion, nativeVersion: config.version,
  runtimeVersion: config.runtimeVersion, projectId: config.extra.eas.projectId,
  environment: process.env.ANTLER_MOBILE_ENV, automation: process.env.ANTLER_MOBILE_AUTOMATION,
  dotenv: process.env.EXPO_NO_DOTENV, nodeEnv: process.env.NODE_ENV,
}));
process.exit(Number(process.env.BUNDLE_TEST_EXIT || 0));
`, { mode: 0o755 });
  const run = (args: string[] = [], extra: Record<string, string> = {}) => spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      BUNDLE_TEST_LOG: log,
      ANTLER_MOBILE_ENV: "development", ANTLER_MOBILE_AUTOMATION: "true", EXPO_NO_DOTENV: "0",
      EXPO_PUBLIC_ANTLER_SERVER_URL: "https://api.example.com",
      ...extra,
    },
  });
  return {
    mobile, log, run, versionFile, nativeConfig, packageConfig,
    version: () => JSON.parse(readFileSync(versionFile, "utf8")).version,
    invocation: () => JSON.parse(readFileSync(log, "utf8")),
  };
}

it("increments the bundled version for both platforms while preserving native compatibility", () => {
  const f = fixture();
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  expect(f.version()).toBe("0.1.10");
  expect(f.invocation()).toEqual({
    args: ["dlx", "eas-cli@latest", "update", "--platform", "all", "--channel", "production", "--environment", "production", "--message", "发布 JS bundle v0.1.10"],
    cwd: f.mobile, bundleVersion: "0.1.10", nativeVersion: "0.1.1",
    runtimeVersion: { policy: "appVersion" }, projectId: "test-project",
    environment: "production", automation: "false", dotenv: "1", nodeEnv: "production",
  });
  expect(readFileSync(join(f.mobile, "app.json"), "utf8")).toBe(f.nativeConfig);
  expect(readFileSync(join(f.mobile, "package.json"), "utf8")).toBe(f.packageConfig);
  expect(f.run().status).toBe(0);
  expect(f.invocation().bundleVersion).toBe("0.1.11");
});

it("passes the update message literally and supports non-interactive publishing", () => {
  const f = fixture();
  const message = '修复 "聊天页面" $(literal)';
  expect(f.run(["--message", message, "--non-interactive"]).status).toBe(0);
  expect(f.invocation().args.slice(-3)).toEqual(["--message", message, "--non-interactive"]);
});

it("keeps a failed publication's version reserved and propagates the CLI failure", () => {
  const f = fixture();
  const failed = f.run([], { BUNDLE_TEST_EXIT: "7" });
  expect(failed.status).toBe(7);
  expect(failed.stderr).toContain("已保留");
  expect(f.version()).toBe("0.1.10");
  expect(f.run().status).toBe(0);
  expect(f.version()).toBe("0.1.11");
});

it("previews the next version without changing files or invoking the publishing CLI", () => {
  const f = fixture();
  const preview = f.run(["--dry-run"]);
  expect(preview.status).toBe(0);
  expect(preview.stdout).toContain("0.1.9 → 0.1.10");
  expect(f.run(["--help"]).status).toBe(0);
  expect(f.version()).toBe("0.1.9");
  expect(existsSync(f.log)).toBe(false);
});

it("rejects invalid inputs before reserving a version or publishing", () => {
  const f = fixture();
  for (const args of [["--message"], ["--message", " "], ["--environment", "development"]]) {
    expect(f.run(args).status).toBe(1);
    expect(f.version()).toBe("0.1.9");
  }
  writeFileSync(f.versionFile, '{"version":"invalid"}');
  expect(f.run().status).toBe(1);
  expect(f.version()).toBe("invalid");
  expect(existsSync(f.log)).toBe(false);
});
