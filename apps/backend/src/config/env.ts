import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { SmtpConfig } from "../agent/email-tool.js";
import { registerProtectedEnvFile } from "./protected-env.js";

const projectRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const envFile = resolve(projectRoot, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
  registerProtectedEnvFile(envFile);
}

export type AppConfig = {
  host: string;
  port: number;
  accessToken?: string;
  authMode?: "local" | "supabase";
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  provider: "anthropic" | "openai";
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  anthropicAuthToken?: string;
  anthropicBaseUrl?: string;
  tavilyApiKey?: string;
  ragUrl?: string;
  ragKey?: string;
  smtp?: SmtpConfig;
  workspaceRoot: string;
  platformRoot?: string;
  staticDir?: string;
  model: string;
  maxRunDurationMs: number;
  agentsDir?: string;
  databaseUrl?: string;
  schedulerEnableScript?: boolean;
  /** 新会话的正文存储介质；缺省为 local。已有会话按各自 messageStorage 路由。 */
  conversationStorage?: "local" | "cos";
  cosPrefix?: string;
  /** 持久暂存日志容量上限（字节）；达到高水位时拒绝新写入并明确报错。 */
  stagingMaxBytes?: number;
  /** GC 宽限期（毫秒）；必须大于允许的最长读取与提交时长。 */
  cosGcGraceMs?: number;
  cos?: {
    secretId: string;
    secretKey: string;
    token?: string;
    region: string;
    bucket: string;
    scheme: string;
    endpoint?: string;
  };
};

const workspaceRoot = resolve(
  projectRoot,
  process.env.ANTLER_WORKSPACE_ROOT ?? "workspace",
);

const smtpPort = Number(process.env.ANTLER_SMTP_PORT ?? 465);
const smtp =
  process.env.ANTLER_SMTP_HOST &&
  process.env.ANTLER_SMTP_FROM &&
  Number.isInteger(smtpPort)
    ? {
        host: process.env.ANTLER_SMTP_HOST,
        port: smtpPort,
        user: process.env.ANTLER_SMTP_USER,
        pass: process.env.ANTLER_SMTP_PASS,
        from: process.env.ANTLER_SMTP_FROM,
      }
    : undefined;

/** Unknown modes must not silently disable authentication. */
export function parseAuthMode(value: string | undefined): "local" | "supabase" {
  if (value === undefined || value === "local") return "local";
  if (value === "supabase") return "supabase";
  throw new Error("ANTLER_AUTH_MODE 无效：仅支持 local 或 supabase。");
}

/** Unknown storage modes must not silently fall back to local files. */
export function parseConversationStorage(
  value: string | undefined,
): "local" | "cos" {
  if (value === undefined || value === "local") return "local";
  if (value === "cos") return "cos";
  throw new Error(
    "ANTLER_CONVERSATION_STORAGE 无效：仅支持 local 或 cos。",
  );
}

const cosRequired = [
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_REGION",
  "COS_BUCKET",
] as const;

function buildCosConfig(): AppConfig["cos"] {
  const values = cosRequired.map((name) => process.env[name]?.trim() ?? "");
  if (values.some((value) => !value)) return undefined;
  return {
    secretId: values[0],
    secretKey: values[1],
    token: process.env.COS_TOKEN?.trim() || undefined,
    region: values[2],
    bucket: values[3],
    scheme: process.env.COS_SCHEME?.trim() || "https",
    endpoint: process.env.COS_ENDPOINT?.trim() || undefined,
  };
}

/** cos 模式缺少必填 COS 配置时必须启动失败，而不是回退到本地存储。 */
export function validateConversationStorageConfig(config: AppConfig): void {
  if ((config.conversationStorage ?? "local") !== "cos") return;
  if (!config.cos)
    throw new Error(
      "ANTLER_CONVERSATION_STORAGE=cos 需要 COS_SECRET_ID、COS_SECRET_KEY、COS_REGION 和 COS_BUCKET。",
    );
}

export const config: AppConfig = {
  host: process.env.ANTLER_HOST ?? "127.0.0.1",
  port: Number(process.env.ANTLER_PORT ?? 3210),
  accessToken: process.env.ANTLER_ACCESS_TOKEN,
  authMode: parseAuthMode(process.env.ANTLER_AUTH_MODE),
  supabaseUrl: process.env.ANTLER_SUPABASE_URL,
  supabasePublishableKey: process.env.ANTLER_SUPABASE_PUBLISHABLE_KEY,
  schedulerEnableScript: process.env.ANTLER_SCHEDULER_ENABLE_SCRIPT === "true",
  provider: process.env.ANTHROPIC_AUTH_TOKEN ? "anthropic" : "openai",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL,
  anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN,
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
  tavilyApiKey: process.env.TAVILY_API_KEY,
  ragUrl: process.env.ANTLER_RAG_URL,
  ragKey: process.env.ANTLER_RAG_KEY,
  smtp,
  workspaceRoot,
  // Local cache of the skill_files table; safe to delete at any time, the
  // contents are rebuilt from the database on the next read.
  platformRoot: resolve(
    projectRoot,
    process.env.ANTLER_PLATFORM_ROOT ?? ".antler-platform",
  ),
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
  databaseUrl: process.env.DATABASE_URL,
  conversationStorage: parseConversationStorage(
    process.env.ANTLER_CONVERSATION_STORAGE,
  ),
  cosPrefix: process.env.ANTLER_COS_PREFIX?.trim() || "antler/conversations/v1",
  stagingMaxBytes: process.env.ANTLER_STAGING_MAX_BYTES
    ? Number(process.env.ANTLER_STAGING_MAX_BYTES)
    : undefined,
  cosGcGraceMs: process.env.ANTLER_COS_GC_GRACE_MS
    ? Number(process.env.ANTLER_COS_GC_GRACE_MS)
    : undefined,
  cos: buildCosConfig(),
};

/** Fail closed before starting a server with incomplete Supabase authentication. */
export function validateAuthConfig(config: AppConfig): void {
  if (
    config.authMode !== undefined &&
    config.authMode !== "local" &&
    config.authMode !== "supabase"
  )
    throw new Error("ANTLER_AUTH_MODE 无效：仅支持 local 或 supabase。");
  if (config.authMode !== "supabase") return;
  let validUrl = false;
  try {
    const url = new URL(config.supabaseUrl ?? "");
    validUrl =
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      config.supabaseUrl === config.supabaseUrl?.trim();
  } catch {
    /* reported below */
  }
  if (
    !validUrl ||
    !config.supabasePublishableKey?.trim() ||
    config.supabasePublishableKey !== config.supabasePublishableKey.trim()
  )
    throw new Error(
      "Supabase 认证配置无效：请检查 ANTLER_SUPABASE_URL 和 ANTLER_SUPABASE_PUBLISHABLE_KEY。",
    );
}
