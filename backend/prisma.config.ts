import { defineConfig } from "prisma/config";
import { relative } from "node:path";
import { config } from "./src/config/env.js";

function cliDatabaseUrl(url?: string) {
  if (!url?.startsWith("file:/") || url.startsWith("file:./")) return url;
  return `file:${relative(process.cwd(), url.slice("file:".length))}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma Migrate expects local SQLite paths relative to the config directory.
    // The runtime keeps an absolute URL so launching the sidecar from another cwd is safe.
    url: cliDatabaseUrl(config.databaseUrl),
  },
});
