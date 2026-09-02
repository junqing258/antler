import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const envFile = resolve(projectRoot, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export type AppConfig = {
  host: string;
  port: number;
  accessToken?: string;
  provider: "anthropic" | "openai";
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  anthropicAuthToken?: string;
  anthropicBaseUrl?: string;
  tavilyApiKey?: string;
  workspaceRoot: string;
  staticDir?: string;
  model: string;
  maxRunDurationMs: number;
  agentsDir?: string;
  databaseUrl?: string;
};

const workspaceRoot = resolve(
  projectRoot,
  process.env.ANTLER_WORKSPACE_ROOT ?? "workspace",
);

export const config: AppConfig = {
  host: process.env.ANTLER_HOST ?? "127.0.0.1",
  port: Number(process.env.ANTLER_PORT ?? 3210),
  accessToken: process.env.ANTLER_ACCESS_TOKEN,
  provider: process.env.ANTHROPIC_AUTH_TOKEN ? "anthropic" : "openai",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL,
  anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN,
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
  tavilyApiKey: process.env.TAVILY_API_KEY,
  workspaceRoot,
  staticDir: process.env.ANTLER_STATIC_DIR
    ? resolve(projectRoot, process.env.ANTLER_STATIC_DIR)
    : undefined,
  model: process.env.ANTHROPIC_AUTH_TOKEN
    ? (process.env.ANTHROPIC_MODEL ??
      process.env.AGENT_RUNTIME_MODEL ??
      "claude-sonnet-4-20250514")
    : (process.env.ANTLER_MODEL ?? "gpt-4.1-mini"),
  maxRunDurationMs: Number(process.env.ANTLER_MAX_RUN_DURATION_MS ?? 120_000),
  agentsDir: process.env.ANTLER_AGENTS_DIR
    ? resolve(projectRoot, process.env.ANTLER_AGENTS_DIR)
    : undefined,
  databaseUrl:
    process.env.DATABASE_URL ?? `file:${resolve(workspaceRoot, "antler.db")}`,
};
