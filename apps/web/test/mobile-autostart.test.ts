import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("opens the configured automation link on an iOS device or simulator", () => {
  const dir = mkdtempSync(join(tmpdir(), "antler-autostart-"));
  const output = join(dir, "args.json");
  const script = resolve(
    import.meta.dirname,
    "../../../scripts/mobile-autostart.mjs",
  );
  try {
    writeFileSync(
      join(dir, "xcrun"),
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(process.env.ANTLER_TEST_ARGS, JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      ANTLER_TEST_ARGS: output,
    };
    execFileSync(
      process.execPath,
      [script, "--platform", "ios", "--message", "hello", "--device", "phone", "--ios-physical"],
      { env },
    );
    const physical = JSON.parse(readFileSync(output, "utf8")) as string[];
    expect(physical.slice(0, 6)).toEqual([
      "devicectl", "device", "process", "launch", "--device", "phone",
    ]);
    expect(physical.slice(-2)).toEqual([
      "antler://autostart?message=hello", "com.antler.p0probe",
    ]);
    expect(physical[6]).toBe("--payload-url");
    execFileSync(process.execPath, [script, "--platform", "ios", "--message", "hello"], { env });
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual([
      "simctl", "openurl", "booted", "antler://autostart?message=hello",
    ]);
    const missingDevice = spawnSync(
      process.execPath,
      [script, "--platform", "ios", "--message", "hello", "--ios-physical"],
      { env },
    );
    expect(missingDevice.status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
