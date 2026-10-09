import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { getProtectedEnvFiles } from "../config/protected-env.js";

export const REDACTED = "[REDACTED]";
const SENSITIVE_NAME =
  /(?:key|token|secret|private|password|passwd|credential|auth|(?:database|db|redis|mongo|postgres|mysql).*url|dsn|cookie)/i;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".codegraph",
  "node_modules",
  "dist",
  "target",
]);
const STRUCTURAL_KEYS = new Set([
  "content",
  "type",
  "text",
  "details",
  "delta",
  "args",
  "command",
  "path",
  "result",
  "summary",
  "isError",
  "error",
  "code",
  "message",
  "mode",
  "hits",
  "citationKey",
  "title",
  "locator",
  "snippet",
  "score",
  "skillId",
  "scope",
  "fingerprint",
  "sizeBytes",
  "directory",
  "status",
  "kind",
  "tool",
]);

export function assertSafeFilePath(path: string) {
  if (
    path.split(/[\\/]/).some((part) => /^\.env(?:$|[.-])/i.test(part)) ||
    basename(path) === "rag-config.json"
  ) {
    throw new Error(
      "secret_access_denied: Environment and credential files are protected.",
    );
  }
}

/** Defense in depth for local tools and the persisted/public run transcript. */
export class SecretGuard {
  private readonly secrets = new Set<string>();
  private values: string[] = [];
  private readonly serverEnvNames = new Set<string>();
  private readonly envFiles = new Map<
    string,
    { mtimeMs: number; ctimeMs: number; size: number; ino: number }
  >();

  constructor(
    private readonly workspaceRoot?: string,
    private readonly getEnvironment?: () => NodeJS.ProcessEnv,
    secretValues: Array<string | undefined> = [],
  ) {
    secretValues.forEach((value) => this.add(value));
    this.captureEnvironment();
  }

  private add(value: string | undefined) {
    if (!value) return;
    const base64 = Buffer.from(value).toString("base64");
    const variants = [
      value,
      base64,
      base64.match(/.{1,76}/g)?.join("\n") ?? base64,
      Buffer.from(value).toString("hex"),
      encodeURIComponent(value),
      JSON.stringify(value).slice(1, -1),
    ];
    for (const variant of variants) {
      if (!this.secrets.has(variant)) {
        this.secrets.add(variant);
        this.values = [];
      }
    }
  }

  captureEnvironment() {
    for (const [name, value] of Object.entries({
      ...process.env,
      ...this.getEnvironment?.(),
    })) {
      if (SENSITIVE_NAME.test(name) || this.serverEnvNames.has(name))
        this.add(value);
    }
  }

  toolEnvironment(): NodeJS.ProcessEnv {
    // Backend credentials are not needed by build/test subprocesses. Explicit
    // skill credentials (e.g. RAG) stay usable, with their output redacted.
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !SENSITIVE_NAME.test(name) && !this.serverEnvNames.has(name),
      ),
    );
    const overrides = this.getEnvironment?.() ?? {};
    for (const [name, value] of Object.entries(overrides)) {
      if (SENSITIVE_NAME.test(name)) this.add(value);
    }
    return { ...environment, ...overrides };
  }

  async refresh() {
    this.captureEnvironment();
    for (const path of getProtectedEnvFiles())
      await this.collectEnvFile(path, true);
    if (!this.workspaceRoot) return;
    const root = await realpath(resolve(this.workspaceRoot)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw new Error(
          "secret_guard_unavailable: Cannot inspect the workspace.",
        );
      },
    );
    if (!root) return;
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (/^\.env(?:$|[.-])/i.test(entry.name) && !entry.isDirectory()) {
          await this.collectEnvFile(path);
        } else if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
          await visit(path);
        }
      }
    };
    await visit(root);
  }

  private async collectEnvFile(path: string, server = false) {
    // Contents and parser errors are never returned to the model or client.
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 256 * 1024) throw new Error();
      const previous = this.envFiles.get(path);
      if (
        previous?.mtimeMs === info.mtimeMs &&
        previous.ctimeMs === info.ctimeMs &&
        previous.size === info.size &&
        previous.ino === info.ino
      )
        return;
      const content = await readFile(path, "utf8");
      this.add(content);
      const values = parseEnv(content);
      for (const [name, value] of Object.entries(values)) {
        this.add(value);
        if (server) {
          this.serverEnvNames.add(name);
          this.add(process.env[name]);
        }
      }
      this.envFiles.set(path, {
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
        size: info.size,
        ino: info.ino,
      });
    } catch (error) {
      if (server && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error(
        "secret_guard_unavailable: Cannot protect environment file contents.",
      );
    }
  }

  private orderedValues() {
    if (!this.values.length)
      this.values = [...this.secrets].sort((a, b) => b.length - a.length);
    return this.values;
  }

  redact(text: string): string {
    // Scan the original text once; replacement markers must not be re-redacted.
    let result = "";
    for (let index = 0; index < text.length;) {
      if (text.startsWith(REDACTED, index)) {
        result += REDACTED;
        index += REDACTED.length;
        continue;
      }
      const secret = this.orderedValues().find((value) =>
        text.startsWith(value, index),
      );
      if (secret) {
        result += REDACTED;
        index += secret.length;
      } else {
        result += text[index++];
      }
    }
    return result;
  }

  sanitize<T>(value: T): T {
    if (typeof value === "string") return this.redact(value) as T;
    if (Array.isArray(value))
      return value.map((item) => this.sanitize(item)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          STRUCTURAL_KEYS.has(key) ? key : this.redact(key),
          key === "type" && (item === "text" || item === "image")
            ? item
            : this.sanitize(item),
        ]),
      ) as T;
    }
    return value;
  }

  stream() {
    let pending = "";
    return {
      push: (delta: string) => {
        pending += delta;
        let result = "";
        let index = 0;
        while (index < pending.length) {
          const remaining = pending.slice(index);
          const values = this.orderedValues();
          // Hold a possible secret prefix until the next chunk, including when
          // a short secret is also a prefix of a longer one.
          if (
            values.some(
              (value) =>
                value.length > remaining.length && value.startsWith(remaining),
            )
          )
            break;
          const secret = values.find((value) =>
            pending.startsWith(value, index),
          );
          if (secret) {
            result += REDACTED;
            index += secret.length;
          } else {
            result += pending[index++];
          }
        }
        pending = pending.slice(index);
        return result;
      },
      finish: () => {
        // A cancelled/failed stream may end midway through a secret.
        const result = pending ? REDACTED : "";
        pending = "";
        return result;
      },
    };
  }
}
