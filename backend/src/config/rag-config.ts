import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig } from "./env.js";

type RagConfig = { ragUrl?: string; ragKey?: string };

export class RagConfigValidationError extends Error {}

export function normalizeRagUrl(value: string): string | null {
  if (!value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RagConfigValidationError("请填写有效的 RAG 服务地址。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new RagConfigValidationError(
      "RAG 地址必须是 HTTPS 服务地址（本机可使用 HTTP），不能包含路径、凭据或查询参数。",
    );
  }
  return url.origin;
}

export class RagConfigStore {
  private readonly path: string;
  private overrides: RagConfig = {};

  constructor(
    private readonly defaults: Pick<AppConfig, "ragUrl" | "ragKey">,
    workspaceRoot: string,
  ) {
    this.path = join(workspaceRoot, ".antler", "rag-config.json");
    if (existsSync(this.path)) {
      const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      this.overrides = this.parse(value);
    }
  }

  private parse(value: unknown): RagConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RagConfigValidationError("知识库配置无效。");
    }
    const { ragUrl, ragKey } = value as Record<string, unknown>;
    if (
      (ragUrl !== undefined && typeof ragUrl !== "string") ||
      (ragKey !== undefined && typeof ragKey !== "string")
    ) {
      throw new RagConfigValidationError("RAG 地址和 API Key 必须是字符串。");
    }
    return {
      ...(typeof ragUrl === "string"
        ? { ragUrl: normalizeRagUrl(ragUrl) ?? "" }
        : {}),
      ...(typeof ragKey === "string" ? { ragKey: ragKey.trim() } : {}),
    };
  }

  private effective(): RagConfig {
    return { ...this.defaults, ...this.overrides };
  }

  publicConfig() {
    const config = this.effective();
    let ragUrl: string | null = null;
    try {
      const origin = normalizeRagUrl(config.ragUrl ?? "");
      ragUrl = origin ? `${origin}/` : null;
    } catch {
      // Invalid environment defaults must not become clickable browser URLs.
    }
    return {
      ragUrl,
      ragKeyConfigured: !!config.ragKey?.trim(),
      ragConfigOverridden: Object.keys(this.overrides).length > 0,
    };
  }

  environment(): NodeJS.ProcessEnv {
    const config = this.effective();
    return {
      ANTLER_RAG_URL: this.publicConfig().ragUrl?.replace(/\/$/, "") ?? "",
      ANTLER_RAG_KEY: config.ragKey?.trim() ?? "",
    };
  }

  update(value: unknown) {
    const next = { ...this.overrides, ...this.parse(value) };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(next), { mode: 0o600 });
      renameSync(temporaryPath, this.path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    this.overrides = next;
    return this.publicConfig();
  }

  reset() {
    rmSync(this.path, { force: true });
    this.overrides = {};
    return this.publicConfig();
  }
}
