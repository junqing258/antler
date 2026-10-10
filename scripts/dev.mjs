import { spawn } from "node:child_process";

const env = { ...process.env };
// pnpm --stream pipes child output, so detect the terminal before starting it.
if (
  process.stdout.isTTY &&
  env.TERM !== "dumb" &&
  env.NO_COLOR === undefined &&
  env.FORCE_COLOR === undefined
) {
  env.FORCE_COLOR = "1";
}

const child = spawn(
  "pnpm",
  ["--parallel", "--stream", "--filter", "@antler/app", "--filter", "@antler/server", "dev"],
  { env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error("Antler development server failed to start:", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
});
