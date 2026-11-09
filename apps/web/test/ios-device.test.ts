/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], buildArgs: string[], exitCode = 0) {
  const root = mkdtempSync(join(tmpdir(), "antler-ios-device-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  cpSync(resolve(import.meta.dirname, "../../mobile/scripts"), join(root, "scripts"), { recursive: true });
  const log = join(root, "commands.jsonl");
  writeFileSync(join(bin, "ipconfig"), "#!/bin/sh\necho 192.168.1.2\n", { mode: 0o755 });
  const mock = `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const tool = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DEVICE_TEST_LOG, JSON.stringify({
  tool, args, path: process.env.PATH,
  environment: process.env.ANTLER_MOBILE_ENV,
  server: process.env.EXPO_PUBLIC_ANTLER_SERVER_URL,
}) + '\\n');
if (tool === 'npx' && args[1] === 'run:ios') {
  const result = spawnSync('xcodebuild', JSON.parse(process.env.DEVICE_TEST_BUILD_ARGS), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
process.exit(tool === 'xcrun' ? Number(process.env.DEVICE_TEST_EXIT) : 0);
`;
  for (const tool of ["npx", "xcrun"]) writeFileSync(join(bin, tool), mock, { mode: 0o755 });
  const result = spawnSync("bash", [join(root, "scripts/ios-device.sh"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ANTLER_PORT: "3210",
      DEVICE_TEST_LOG: log,
      DEVICE_TEST_BUILD_ARGS: JSON.stringify(buildArgs),
      DEVICE_TEST_EXIT: String(exitCode),
    },
  });
  const commands = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  return { result, commands };
}

it("allows provisioning renewal for an already configured iPhone build and preserves arguments", () => {
  const buildArgs = ["-workspace", "/project with spaces/Antler.xcworkspace", "-destination", "id=PHONE"];
  const { result, commands } = run(["--configuration", "Debug", "--no-bundler"], buildArgs);
  expect(result.status).toBe(0);
  expect(commands[0]).toMatchObject({
    args: ["expo", "run:ios", "--device", "--configuration", "Debug", "--no-bundler"],
    environment: "development",
    server: "http://192.168.1.2:3210",
  });
  expect(commands[1]).toMatchObject({
    tool: "xcrun",
    args: ["xcodebuild", ...buildArgs, "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration"],
  });
});

it("leaves Xcode metadata queries unchanged", () => {
  const { result, commands } = run([], ["-version"]);
  expect(result.status).toBe(0);
  expect(commands[1].args).toEqual(["xcodebuild", "-version"]);
});

it("propagates Xcode build failures", () => {
  const { result } = run([], ["-destination", "id=PHONE"], 65);
  expect(result.status).toBe(65);
});

it("starts Metro without adding the signing wrapper to PATH", () => {
  const { result, commands } = run(["metro", "--port", "8082"], []);
  expect(result.status).toBe(0);
  expect(commands).toHaveLength(1);
  expect(commands[0].args).toEqual(["expo", "start", "--port", "8082"]);
  expect(commands[0].path).not.toContain("/scripts/ios-bin:");
});
