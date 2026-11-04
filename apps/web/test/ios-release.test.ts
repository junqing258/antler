/// <reference types="node" />
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const fixtures: string[] = [];
const macIt = it.skipIf(process.platform !== "darwin");
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "antler-ios-release-"));
  fixtures.push(root);
  const mobile = join(root, "mobile");
  const bin = join(root, "bin");
  mkdirSync(join(mobile, "scripts"), { recursive: true });
  mkdirSync(join(mobile, "node_modules"));
  mkdirSync(join(mobile, "ios"));
  mkdirSync(bin);
  const script = join(mobile, "scripts", "ios-release.mjs");
  copyFileSync(resolve(import.meta.dirname, "../../mobile/scripts/ios-release.mjs"), script);
  writeFileSync(join(mobile, "ios", "development.txt"), "keep development project");
  writeFileSync(join(mobile, ".env.production"), "SECRET=not-for-release-staging");
  writeFileSync(join(mobile, "package.json"), '{"name":"release-fixture"}');
  const log = join(root, "commands.jsonl");
  const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const tool = process.argv[1].endsWith(path.join('expo', 'bin', 'cli')) ? 'expo' : path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify({
  tool, args, cwd: process.cwd(), production: process.env.ANTLER_MOBILE_ENV,
  automation: process.env.ANTLER_MOBILE_AUTOMATION, server: process.env.EXPO_PUBLIC_ANTLER_SERVER_URL,
  dotenv: process.env.EXPO_NO_DOTENV,
  copiedEnv: fs.existsSync('.env.production'), copiedNative: fs.existsSync('ios/development.txt'),
}) + '\\n');
if (tool === 'pnpm') process.exit(99);
if (tool === 'expo') {
  fs.mkdirSync('ios/Antler.xcworkspace', { recursive: true });
}
if (tool === 'xcodebuild' && args.includes('archive')) {
  if (process.env.RELEASE_TEST_FAIL) process.exit(9);
  const app = path.join(args[args.indexOf('-archivePath') + 1], 'Products/Applications/Antler.app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'main.jsbundle'), 'release bundle');
  fs.writeFileSync(path.join(app, 'Info.plist'), 'mock plist');
}
if (tool === 'xcodebuild' && args.includes('-exportArchive')) {
  if (process.env.RELEASE_TEST_FAIL_EXPORT) {
    console.error('The selected team does not have a program membership that is eligible for this feature.');
    process.exit(70);
  }
  const output = args[args.indexOf('-exportPath') + 1];
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'Antler.ipa'), 'mock archive export');
}
if (tool === 'plutil') process.stdout.write('com.antler.p0probe');
if (tool === 'xcrun' && args.includes('list')) {
  const devices = process.env.RELEASE_TEST_DEVICES ? JSON.parse(process.env.RELEASE_TEST_DEVICES) : [
    { identifier: 'PHONE', properties: {
      hardware: { reality: 'physical', deviceType: 'iPhone', udid: 'IPHONE-UDID' },
      connection: { state: 'connected' }, state: { name: 'Test iPhone' },
    } },
    { identifier: 'SIMULATOR', properties: {
      hardware: { reality: 'simulated', deviceType: 'iPhone', udid: 'SIMULATOR' },
      connection: { state: 'connected' },
    } },
  ];
  fs.writeFileSync(args[args.indexOf('--json-output') + 1], JSON.stringify({ result: { devices } }));
}
if (tool === 'xcrun' && args.includes('launch') && process.env.RELEASE_TEST_FAIL_LAUNCH) process.exit(1);
`;
  const expo = join(mobile, "node_modules", "expo");
  mkdirSync(join(expo, "bin"), { recursive: true });
  writeFileSync(join(expo, "package.json"), JSON.stringify({
    name: "expo", exports: { "./bin/cli": "./bin/cli" },
  }));
  writeFileSync(join(expo, "bin", "cli"), mock);
  for (const tool of ["pnpm", "pod", "xcodebuild", "xcrun", "plutil"]) {
    writeFileSync(join(bin, tool), mock, { mode: 0o755 });
  }
  function run(args: string[], extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, INIT_CWD: root,
        RELEASE_TEST_LOG: log, APPLE_TEAM_ID: "ABCDEFGHIJ",
        EXPO_PUBLIC_ANTLER_SERVER_URL: "https://api.example.com",
        ANTLER_MOBILE_ENV: "development", ANTLER_MOBILE_AUTOMATION: "true",
        ...extraEnv,
      },
    });
  }
  const commands = () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  return { root, mobile, log, run, commands };
}

macIt("archives current sources in production and exports an IPA without changing development files", () => {
  const f = fixture();
  const result = f.run(["--output", "release output"]);
  expect(result.status, result.stderr).toBe(0);
  const commands = f.commands();
  expect(commands.some((command) => command.tool === "pnpm")).toBe(false);
  const prebuild = commands.find((command) => command.tool === "expo");
  expect(prebuild).toMatchObject({
    production: "production", automation: "false", dotenv: "1",
    server: "https://api.example.com", copiedEnv: false, copiedNative: false,
  });
  expect(prebuild.args).toEqual(["prebuild", "--platform", "ios", "--no-install"]);
  const archive = commands.find((command) => command.args.includes("archive"));
  expect(archive.args).toEqual(expect.arrayContaining([
    "Release", "generic/platform=iOS", "DEVELOPMENT_TEAM=ABCDEFGHIJ", "ENABLE_USER_SCRIPT_SANDBOXING=NO",
  ]));
  expect(existsSync(join(f.root, "release output", "ipa", "Antler.ipa"))).toBe(true);
  const plist = readFileSync(join(f.root, "release output", "ExportOptions.plist"), "utf8");
  expect(plist).toContain("<string>app-store-connect</string>");
  expect(plist).toContain("<string>export</string>");
  expect(readFileSync(join(f.mobile, "ios", "development.txt"), "utf8")).toBe("keep development project");
  expect(readdirSync(join(f.mobile, "dist"))).toEqual([]);
});

macIt("supports archive-only and stops before export if archiving fails", () => {
  const f = fixture();
  expect(f.run(["--archive-only", "--output", "archive"]).status).toBe(0);
  expect(f.commands().some((command) => command.args.includes("-exportArchive"))).toBe(false);
  const failed = f.run(["--output", "failed"], { RELEASE_TEST_FAIL: "1" });
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain("xcodebuild 执行失败");
  expect(f.commands().some((command) => command.args.includes("-exportArchive"))).toBe(false);
  expect(readdirSync(join(f.mobile, "dist"))).toEqual([]);
});

macIt("preserves a successful archive and explains an IPA export failure", () => {
  const f = fixture();
  const result = f.run(["--output", "failed-export"], { RELEASE_TEST_FAIL_EXPORT: "1" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("program membership");
  expect(result.stderr).toContain("Release 归档已成功，IPA 导出失败");
  expect(result.stderr).toContain("xcodebuild 执行失败（70）");
  const archive = join(f.root, "failed-export", "Antler.xcarchive");
  expect(result.stderr).toContain(`归档已保留：${archive}`);
  expect(existsSync(archive)).toBe(true);
  expect(existsSync(join(f.root, "failed-export", "ipa"))).toBe(false);
  expect(readdirSync(join(f.mobile, "dist"))).toEqual([]);
});

macIt("builds a development-signed Release for the connected iPhone and installs it without IPA export", () => {
  const f = fixture();
  const result = f.run(["--install", "--output", "personal"]);
  expect(result.status, result.stderr).toBe(0);
  const commands = f.commands();
  const archive = commands.find((command) => command.args.includes("archive"));
  expect(archive.args).toEqual(expect.arrayContaining([
    "Release", "id=IPHONE-UDID", "CODE_SIGN_IDENTITY=Apple Development", "-allowProvisioningDeviceRegistration",
  ]));
  expect(commands.some((command) => command.args.includes("-exportArchive"))).toBe(false);
  const install = commands.find((command) => command.tool === "xcrun" && command.args.includes("install"));
  expect(install.args).toContain("IPHONE-UDID");
  expect(install.args).toContain(join(f.root, "personal", "Antler.xcarchive", "Products", "Applications", "Antler.app"));
  expect(commands.find((command) => command.args.includes("launch")).args).toContain("com.antler.p0probe");
});

macIt("installs an existing archive without rebuilding or requiring a team", () => {
  const f = fixture();
  expect(f.run(["--archive-only", "--output", "existing"]).status).toBe(0);
  const count = f.commands().length;
  const result = f.run([
    "--install", "--archive", "existing/Antler.xcarchive", "--device", "IPHONE-UDID",
  ], { APPLE_TEAM_ID: "" });
  expect(result.status, result.stderr).toBe(0);
  const commands = f.commands().slice(count);
  expect(commands.some((command) => ["pnpm", "expo", "pod", "xcodebuild"].includes(command.tool))).toBe(false);
  expect(commands.some((command) => command.args.includes("install"))).toBe(true);
});

macIt("requires a unique connected iPhone and allows explicit selection", () => {
  const f = fixture();
  const device = (udid: string) => ({
    identifier: udid,
    properties: {
      hardware: { reality: "physical", deviceType: "iPhone", udid },
      connection: { state: "connected" },
    },
  });
  const ambiguous = { RELEASE_TEST_DEVICES: JSON.stringify([device("ONE"), device("TWO")]) };
  const result = f.run(["--install"], ambiguous);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("多台已连接 iPhone");
  expect(f.commands().some((command) => command.tool === "expo")).toBe(false);
  expect(f.run(["--install", "--device", "TWO", "--output", "selected"], ambiguous).status).toBe(0);
  const missing = f.run(["--install"], { RELEASE_TEST_DEVICES: "[]" });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("未找到已连接");
});

macIt("keeps a successful installation when device launch is blocked", () => {
  const f = fixture();
  const result = f.run(["--install", "--output", "locked"], { RELEASE_TEST_FAIL_LAUNCH: "1" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Release 应用已安装，但启动失败");
  expect(result.stderr).toContain("解锁 iPhone");
  expect(existsSync(join(f.root, "locked", "Antler.xcarchive"))).toBe(true);
});

macIt("resolves custom export settings from the invoking directory and honors explicit team and endpoint", () => {
  const f = fixture();
  mkdirSync(join(f.mobile, "ios", "Local.xcodeproj"));
  writeFileSync(join(f.mobile, "ios", "Local.xcodeproj", "project.pbxproj"), "DEVELOPMENT_TEAM = LOCAL12345;");
  writeFileSync(join(f.root, "Custom.plist"), "custom export settings");
  const result = f.run([
    "--team", "1234567890", "--server-url", "https://release.example.com",
    "--output", "custom", "--export-options", "Custom.plist",
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(f.commands().find((command) => command.tool === "expo").server).toBe("https://release.example.com");
  const exportCommand = f.commands().find((command) => command.args.includes("-exportArchive"));
  expect(exportCommand.args).toContain(join(f.root, "Custom.plist"));
  expect(f.commands().find((command) => command.args.includes("archive")).args).toContain("DEVELOPMENT_TEAM=1234567890");
});

macIt("uses the unique team from local Xcode projects when no explicit team is supplied", () => {
  const f = fixture();
  mkdirSync(join(f.mobile, "ios", "Local.xcodeproj"));
  writeFileSync(join(f.mobile, "ios", "Local.xcodeproj", "project.pbxproj"), `
    DEVELOPMENT_TEAM = LOCAL12345;
    DEVELOPMENT_TEAM = "LOCAL12345";
  `);
  const result = f.run(["--output", "local"], { APPLE_TEAM_ID: "" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Apple Team ID：LOCAL12345");
  expect(f.commands().find((command) => command.args.includes("archive")).args).toContain("DEVELOPMENT_TEAM=LOCAL12345");
  expect(readFileSync(join(f.root, "local", "ExportOptions.plist"), "utf8")).toContain("<string>LOCAL12345</string>");
});

macIt("allows an environment team to override ambiguous local projects", () => {
  const f = fixture();
  mkdirSync(join(f.mobile, "ios", "Local.xcodeproj"));
  writeFileSync(join(f.mobile, "ios", "Local.xcodeproj", "project.pbxproj"), `
    DEVELOPMENT_TEAM = LOCAL12345;
    DEVELOPMENT_TEAM = OTHER12345;
  `);
  const ambiguous = f.run([], { APPLE_TEAM_ID: "" });
  expect(ambiguous.status).toBe(1);
  expect(ambiguous.stderr).toContain("多个 Apple Team ID");
  expect(existsSync(f.log)).toBe(false);
  const result = f.run(["--archive-only", "--output", "override"]);
  expect(result.status, result.stderr).toBe(0);
  expect(f.commands().find((command) => command.args.includes("archive")).args).toContain("DEVELOPMENT_TEAM=ABCDEFGHIJ");
});

it("rejects invalid release settings before invoking build tools", () => {
  const f = fixture();
  expect(f.run([], { APPLE_TEAM_ID: "" }).status).toBe(1);
  expect(f.run(["--server-url", "http://192.168.1.2:3210"]).status).toBe(1);
  expect(f.run(["--export-options", "missing.plist"]).status).toBe(1);
  expect(existsSync(f.log)).toBe(false);
});
