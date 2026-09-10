import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { config } from "../src/config/env.js";

// Migrate before onReady recovery touches the database, including on first boot.
const url = config.databaseUrl;
if (url?.startsWith("file:")) {
  mkdirSync(dirname(resolve(url.slice(5))), { recursive: true });
}
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
  { stdio: "inherit" },
);
if (result.error) console.error("Unable to apply development migrations:", result.error);
process.exitCode = result.status ?? 1;
