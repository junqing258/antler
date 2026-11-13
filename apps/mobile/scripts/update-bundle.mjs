import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("../", import.meta.url));
const versionPath = new URL("../bundle-version.json", import.meta.url);
const help = `用法：pnpm update:bundle [选项]

  --message, -m <说明>  更新说明，默认包含新的 bundle 版本号
  --non-interactive    不显示 EAS 交互提示（CI 需配置 EXPO_TOKEN）
  --dry-run            仅预览下一版本和发布命令，不修改文件或联网
  --help, -h           显示帮助

发布前自动递增 bundle-version.json 的补丁号，同时发布 iOS 和 Android。
使用 production 频道和环境，不修改原生应用版本或 runtimeVersion。
失败时保留已递增的版本号，下次发布继续递增，避免复用可能已上传的版本。`;

function main() {
  const options = { dryRun: false, nonInteractive: false, message: undefined };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(help);
      return;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--non-interactive") {
      options.nonInteractive = true;
    } else if (arg === "--message" || arg === "-m") {
      const value = args[++index];
      if (!value?.trim() || value.startsWith("--"))
        throw new Error("--message 需要非空的更新说明。");
      options.message = value;
    } else {
      throw new Error(`无效参数：${arg}\n${help}`);
    }
  }

  const bundle = JSON.parse(readFileSync(versionPath, "utf8"));
  if (typeof bundle.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(bundle.version))
    throw new Error("bundle-version.json 的 version 必须为 x.y.z 格式的非负整数版本号。");
  const [major, minor, patch] = bundle.version.split(".").map(Number);
  if (![major, minor, patch + 1].every(Number.isSafeInteger))
    throw new Error("bundle 版本号超出安全整数范围。");
  const nextVersion = `${major}.${minor}.${patch + 1}`;
  const commandArgs = [
    "dlx", "eas-cli@latest", "update",
    "--platform", "all", "--channel", "production", "--environment", "production",
    "--message", options.message ?? `发布 JS bundle v${nextVersion}`,
    ...(options.nonInteractive ? ["--non-interactive"] : []),
  ];
  console.log(`JS bundle：${bundle.version} → ${nextVersion}`);
  if (options.dryRun) {
    console.log(`预览（不执行）：pnpm ${commandArgs.map((arg) => JSON.stringify(arg)).join(" ")}`);
    return;
  }

  // Reserve the version before bundling; both platforms compile the same value.
  writeFileSync(versionPath, `${JSON.stringify({ ...bundle, version: nextVersion }, null, 2)}\n`);
  const result = spawnSync("pnpm", commandArgs, {
    cwd: mobileRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      ANTLER_MOBILE_ENV: "production",
      ANTLER_MOBILE_AUTOMATION: "false",
      EXPO_NO_DOTENV: "1",
    },
  });
  if (result.error || result.status !== 0) {
    console.error(`发布失败：${result.error?.message ?? result.signal ?? result.status}。bundle v${nextVersion} 已保留，下次发布继续递增。`);
    process.exitCode = result.status || 1;
    return;
  }
  console.log(`JS bundle v${nextVersion} 已发布到 iOS / Android production 频道。`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
