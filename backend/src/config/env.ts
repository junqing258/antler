import { existsSync } from "node:fs";
import { resolve } from "node:path";

// `pnpm --filter @antler/server` runs from server/, while direct execution is
// normally from the repository root. Load either location without overriding
// values explicitly supplied by the environment.
for (const path of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
]) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
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
};

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
  workspaceRoot: resolve(process.env.ANTLER_WORKSPACE_ROOT ?? process.cwd()),
  staticDir: process.env.ANTLER_STATIC_DIR
    ? resolve(process.env.ANTLER_STATIC_DIR)
    : undefined,
  model: process.env.ANTHROPIC_AUTH_TOKEN
    ? (process.env.ANTHROPIC_MODEL ??
      process.env.AGENT_RUNTIME_MODEL ??
      "claude-sonnet-4-20250514")
    : (process.env.ANTLER_MODEL ?? "gpt-4.1-mini"),
  maxRunDurationMs: Number(process.env.ANTLER_MAX_RUN_DURATION_MS ?? 120_000),
  agentsDir: process.env.ANTLER_AGENTS_DIR
    ? resolve(process.env.ANTLER_AGENTS_DIR)
    : undefined,
};
