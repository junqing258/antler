#!/usr/bin/env node
// Opens a test-build deep link. The backend endpoint always comes from the build.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    platform: { type: "string" },
    message: { type: "string" },
    "cancel-after": { type: "string" },
    "agent-id": { type: "string" },
    "conversation-id": { type: "string" },
    device: { type: "string" },
    "ios-physical": { type: "boolean", default: false },
  },
});
if (
  !values.platform ||
  !["ios", "android"].includes(values.platform) ||
  !values.message ||
  (values["ios-physical"] && (values.platform !== "ios" || !values.device))
) {
  console.error(
    "Usage: node scripts/mobile-autostart.mjs --platform ios|android --message <text> [--cancel-after milliseconds] [--device id] [--ios-physical]",
  );
  process.exit(2);
}
const url = new URL("antler://autostart");
url.searchParams.set("message", values.message);
if (values["cancel-after"])
  url.searchParams.set("cancelAfter", values["cancel-after"]);
if (values["agent-id"]) url.searchParams.set("agentId", values["agent-id"]);
if (values["conversation-id"])
  url.searchParams.set("conversationId", values["conversation-id"]);
if (values["ios-physical"])
  execFileSync(
    "xcrun",
    [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      values.device,
      "--payload-url",
      url.toString(),
      "com.antler.p0probe",
    ],
    { stdio: "inherit" },
  );
else if (values.platform === "ios")
  execFileSync(
    "xcrun",
    ["simctl", "openurl", values.device ?? "booted", url.toString()],
    { stdio: "inherit" },
  );
else
  execFileSync(
    "adb",
    [
      ...(values.device ? ["-s", values.device] : []),
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `'${url.toString()}'`,
      "com.antler.p0probe",
    ],
    { stdio: "inherit" },
  );
