import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("../", import.meta.url));
const invocationRoot = process.env.INIT_CWD || process.cwd();
const help = `用法：pnpm build:ios [选项]

  --team <id>                覆盖 Apple Team ID，也可设置 APPLE_TEAM_ID
  --server-url <https-url>   后端地址，默认 https://chat.xiaoanai.top
  --output <目录>           产物目录，默认 apps/mobile/dist/ios/<时间>
  --export-options <plist>  使用自己的 ExportOptions.plist
  --archive-only           仅生成 .xcarchive，稍后在 Xcode 中分发
  --install                用开发签名构建 Release 并安装到 iPhone，不导出 IPA
  --device <UDID>          指定 iPhone；默认自动选择唯一已连接真机
  --archive <路径>         配合 --install，直接安装已有归档，跳过构建
  --help                   显示帮助

默认从本机 apps/mobile/ios/*.xcodeproj 读取 Apple Team ID。
默认生成 App Store Connect 分发用 .ipa，不自动上传。
需要 macOS、Xcode、CocoaPods，以及已在 Xcode 登录的开发者账号。`;

function deviceCommand(command, args, capture = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} 执行失败（${result.signal || result.status}）。${capture ? result.stderr : ""}`);
  return result.stdout;
}

function selectDevice(requested) {
  const temp = mkdtempSync(join(tmpdir(), "antler-ios-devices-"));
  try {
    const file = join(temp, "devices.json");
    deviceCommand("xcrun", ["devicectl", "list", "devices", "--quiet", "--timeout", "30", "--json-output", file]);
    const devices = JSON.parse(readFileSync(file, "utf8")).result.devices.filter((device) => {
      const hardware = device.properties?.hardware || device.hardwareProperties;
      const connection = device.properties?.connection || device.connectionProperties;
      return hardware?.reality === "physical" && hardware.deviceType === "iPhone" &&
        (connection?.state || connection?.tunnelState) === "connected";
    });
    const matches = requested ? devices.filter((device) =>
      device.identifier === requested ||
      (device.properties?.hardware || device.hardwareProperties)?.udid === requested,
    ) : devices;
    if (matches.length !== 1)
      throw new Error(matches.length === 0
        ? "未找到已连接的目标 iPhone。请连接并解锁手机，确认信任电脑并开启开发者模式。"
        : "检测到多台已连接 iPhone，请通过 --device <UDID> 指定设备。");
    const device = matches[0];
    return {
      id: (device.properties?.hardware || device.hardwareProperties).udid || device.identifier,
      name: (device.properties?.state || device.deviceProperties)?.name || device.identifier,
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function installArchive(archive, device) {
  const applications = join(archive, "Products", "Applications");
  const apps = existsSync(applications)
    ? readdirSync(applications).filter((name) => name.endsWith(".app")) : [];
  if (apps.length !== 1) throw new Error(`归档中未找到唯一应用：${archive}`);
  const app = join(applications, apps[0]);
  if (!existsSync(join(app, "main.jsbundle")))
    throw new Error("应用缺少内置 JS bundle，请使用 Release 归档。");
  const bundleId = deviceCommand("plutil", [
    "-extract", "CFBundleIdentifier", "raw", "-o", "-", join(app, "Info.plist"),
  ], true).trim();
  console.log(`安装到 ${device.name}（${device.id}）：${app}`);
  deviceCommand("xcrun", ["devicectl", "device", "install", "app", "--device", device.id, app, "--timeout", "60"]);
  try {
    deviceCommand("xcrun", [
      "devicectl", "device", "process", "launch", "--device", device.id,
      "--terminate-existing", bundleId, "--timeout", "30",
    ]);
  } catch (error) {
    throw new Error(`Release 应用已安装，但启动失败：${error.message}\n请解锁 iPhone，在设置中确认开发者信任后手动打开 Antler。`);
  }
  console.log("Release 已安装并启动，无需 Metro。Personal Team 签名过期后需要重新构建安装。");
}

function localTeamId() {
  const ios = join(mobileRoot, "ios");
  if (!existsSync(ios)) return undefined;
  const teams = new Set();
  for (const project of readdirSync(ios).filter((name) => name.endsWith(".xcodeproj"))) {
    const file = join(ios, project, "project.pbxproj");
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bDEVELOPMENT_TEAM\s*=\s*"?([A-Z0-9]{10})"?\s*;/g)) {
      teams.add(match[1]);
    }
  }
  if (teams.size > 1)
    throw new Error(`本机 iOS 工程配置了多个 Apple Team ID（${[...teams].join(", ")}），请通过 --team 或 APPLE_TEAM_ID 指定。`);
  return [...teams][0];
}

function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(help);
      return;
    }
    if (arg === "--archive-only" || arg === "--install") {
      options[arg === "--install" ? "install" : "archiveOnly"] = true;
      continue;
    }
    const names = {
      "--team": "team", "--server-url": "serverUrl",
      "--output": "output", "--export-options": "exportOptions",
      "--device": "device", "--archive": "archive",
    };
    if (!names[arg] || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(`无效参数或缺少参数值：${arg}\n${help}`);
    options[names[arg]] = args[++i];
  }

  if ((options.archive || options.device) && !options.install)
    throw new Error("--archive 和 --device 需要配合 --install 使用。");
  if (options.install && (options.archiveOnly || options.exportOptions))
    throw new Error("--install 不能与 --archive-only 或 --export-options 同时使用。");
  if (process.platform !== "darwin") throw new Error("iOS 打包需要 macOS 和 Xcode。");
  if (options.archive) {
    installArchive(resolve(invocationRoot, options.archive), selectDevice(options.device));
    return;
  }

  const team = options.team || process.env.APPLE_TEAM_ID || localTeamId();
  if (!team || !/^[A-Z0-9]{10}$/.test(team))
    throw new Error("未找到有效 Apple Team ID。请在本机 iOS 工程中配置 Team，或通过 --team / APPLE_TEAM_ID 提供 10 位 Team ID。");
  const serverUrl = options.serverUrl || process.env.EXPO_PUBLIC_ANTLER_SERVER_URL || "https://chat.xiaoanai.top";
  const endpoint = new URL(serverUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("正式包后端必须为 HTTPS 地址，且不能包含凭据、查询参数或 fragment。");
  const exportOptions = options.exportOptions && resolve(invocationRoot, options.exportOptions);
  if (exportOptions && !existsSync(exportOptions))
    throw new Error(`导出配置不存在：${exportOptions}`);
  if (!existsSync(join(mobileRoot, "node_modules")))
    throw new Error("请先在仓库根目录运行 pnpm install。");
  const expoCli = createRequire(import.meta.url).resolve("expo/bin/cli");
  console.log(`Apple Team ID：${team}`);
  const device = options.install ? selectDevice(options.device) : undefined;

  const env = {
    ...process.env,
    NODE_ENV: "production",
    NODE_BINARY: process.execPath,
    ANTLER_MOBILE_ENV: "production",
    ANTLER_MOBILE_AUTOMATION: "false",
    EXPO_PUBLIC_ANTLER_SERVER_URL: serverUrl,
    EXPO_NO_DOTENV: "1",
  };
  function run(command, commandArgs, cwd = mobileRoot) {
    const result = spawnSync(command, commandArgs, { cwd, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${command} 执行失败（${result.signal || result.status}）。`);
  }
  run("xcodebuild", ["-version"]);
  run("pod", ["--version"]);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = options.output
    ? resolve(invocationRoot, options.output)
    : join(mobileRoot, "dist", "ios", stamp);
  mkdirSync(output, { recursive: true });
  const archive = join(output, "Antler.xcarchive");
  if (existsSync(archive) || existsSync(join(output, "ipa")))
    throw new Error(`产物已存在，请使用新的 --output 目录：${output}`);

  mkdirSync(join(mobileRoot, "dist"), { recursive: true });
  const project = mkdtempSync(join(mobileRoot, "dist", ".ios-release-"));
  console.log(`生产后端：${serverUrl}\n构建目录：${project}\n产物目录：${output}`);
  // Generate native files from current sources without touching the development project.
  const excluded = new Set(["ios", "android", "node_modules", "dist", "dist-p0", ".expo", ".git"]);
  try {
    for (const entry of readdirSync(mobileRoot)) {
      if (excluded.has(entry) || entry.startsWith(".env")) continue;
      cpSync(join(mobileRoot, entry), join(project, entry), { recursive: true });
    }
    symlinkSync(join(mobileRoot, "node_modules"), join(project, "node_modules"), "dir");
    // The staging directory is not a workspace member. Calling pnpm exec there
    // can trigger dependency installation and fail to resolve workspace:* links.
    run(process.execPath, [expoCli, "prebuild", "--platform", "ios", "--no-install"], project);
    const ios = join(project, "ios");
    run("pod", ["install"], ios);
    const workspaces = readdirSync(ios).filter((name) => name.endsWith(".xcworkspace"));
    if (workspaces.length !== 1) throw new Error("无法唯一确定生成的 Xcode workspace。");
    const workspace = workspaces[0];
    run("xcodebuild", [
      "-workspace", join(ios, workspace),
      "-scheme", basename(workspace, ".xcworkspace"),
      "-configuration", "Release", "-destination", device ? `id=${device.id}` : "generic/platform=iOS",
      "-archivePath", archive, "-derivedDataPath", join(project, "DerivedData"),
      "-allowProvisioningUpdates", `DEVELOPMENT_TEAM=${team}`,
      ...(device ? ["-allowProvisioningDeviceRegistration", "CODE_SIGN_IDENTITY=Apple Development"] : []),
      "CODE_SIGN_STYLE=Automatic", "ENABLE_USER_SCRIPT_SANDBOXING=NO", "archive",
    ], project);
    if (!existsSync(archive)) throw new Error("Xcode 未生成预期归档。");
    console.log(`归档：${archive}`);

    if (device) {
      installArchive(archive, device);
    } else if (!options.archiveOnly) {
      const plist = exportOptions || join(output, "ExportOptions.plist");
      if (!exportOptions) writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>${team}</string>
</dict></plist>
`);
      const ipa = join(output, "ipa");
      try {
        run("xcodebuild", [
          "-exportArchive", "-archivePath", archive,
          "-exportPath", ipa, "-exportOptionsPlist", plist, "-allowProvisioningUpdates",
        ], project);
        if (!existsSync(ipa) || !readdirSync(ipa).some((name) => name.endsWith(".ipa")))
          throw new Error("Xcode 未生成预期 .ipa 文件。");
      } catch (error) {
        throw new Error(`Release 归档已成功，IPA 导出失败：${error.message}\n归档已保留：${archive}\n请查看上方 Xcode 原始错误。App Store 导出需要具备分发资格的 Apple Team、Distribution 证书及描述文件；可在 Xcode 中打开此归档处理签名并重新导出。`);
      }
      console.log(`IPA：${ipa}`);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`iOS 正式打包失败：${error.message}`);
  process.exitCode = 1;
}
