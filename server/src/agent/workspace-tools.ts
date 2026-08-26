import { mkdir, readFile, realpath, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_COMMAND_OUTPUT = 32 * 1024;

function textResult(text: string, details?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

function truncate(text: string, maximum = MAX_COMMAND_OUTPUT) {
  return text.length > maximum ? `${text.slice(0, maximum)}\n…(output truncated)` : text;
}

/** Resolves user paths without permitting a `..` escape or a symlink escape. */
async function workspacePath(workspaceRoot: string, path: string, allowMissing = false) {
  if (!path.trim()) throw new Error("Path must not be empty.");
  const candidate = resolve(workspaceRoot, path);
  if (isAbsolute(path) || (relative(workspaceRoot, candidate).startsWith("..") || isAbsolute(relative(workspaceRoot, candidate)))) {
    throw new Error("Path must be inside the workspace.");
  }

  const existing = allowMissing ? await nearestExistingPath(candidate) : candidate;
  const actual = await realpath(existing);
  const root = await realpath(workspaceRoot);
  if (actual !== root && !actual.startsWith(`${root}/`)) {
    throw new Error("Path resolves outside the workspace.");
  }
  return candidate;
}

async function nearestExistingPath(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await stat(current);
      return current;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

const readParameters = Type.Object({
  path: Type.String({ minLength: 1, description: "Workspace-relative file or directory path." }),
  startLine: Type.Optional(Type.Integer({ minimum: 1, description: "First file line to return (1-based)." })),
  endLine: Type.Optional(Type.Integer({ minimum: 1, description: "Last file line to return (inclusive)." })),
});

const writeParameters = Type.Object({
  path: Type.String({ minLength: 1, description: "Workspace-relative path to create or overwrite." }),
  content: Type.String({ description: "Complete UTF-8 file content." }),
});

const editParameters = Type.Object({
  path: Type.String({ minLength: 1, description: "Workspace-relative path to edit." }),
  oldText: Type.String({ minLength: 1, description: "Exact text to replace; it must occur exactly once." }),
  newText: Type.String({ description: "Replacement text." }),
});

const bashParameters = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 8_000, description: "Command to run with bash in the workspace." }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 60_000, description: "Command timeout in milliseconds." })),
});

type ReadInput = { path: string; startLine?: number; endLine?: number };
type WriteInput = { path: string; content: string };
type EditInput = { path: string; oldText: string; newText: string };
type BashInput = { command: string; timeoutMs?: number };

export function createWorkspaceTools(workspaceRoot: string) {
  const root = resolve(workspaceRoot);
  const tools = [
    {
      name: "read",
      label: "Read file",
      description: "Read a UTF-8 file or list a directory inside the workspace. Paths must be relative to the workspace.",
      parameters: readParameters,
      async execute(_id: string, { path, startLine, endLine }: ReadInput) {
        const target = await workspacePath(root, path);
        const info = await stat(target);
        if (info.isDirectory()) {
          const entries = await readdir(target, { withFileTypes: true });
          return textResult(entries.map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`).join("\n") || "(empty directory)");
        }
        if (!info.isFile()) throw new Error("Only regular files can be read.");
        if (info.size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES} byte read limit.`);
        const lines = (await readFile(target, "utf8")).split("\n");
        const first = (startLine ?? 1) - 1;
        const last = endLine ?? lines.length;
        if (last < first + 1) throw new Error("endLine must not be before startLine.");
        return textResult(lines.slice(first, last).map((line, index) => `${first + index + 1}: ${line}`).join("\n"));
      },
    },
    {
      name: "write",
      label: "Write file",
      description: "Create or overwrite a UTF-8 file inside the workspace.",
      parameters: writeParameters,
      async execute(_id: string, { path, content }: WriteInput) {
        const target = await workspacePath(root, path, true);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
        return textResult(`Wrote ${content.length} characters to ${path}.`);
      },
    },
    {
      name: "edit",
      label: "Edit file",
      description: "Replace one exact, unique text fragment in a UTF-8 workspace file.",
      parameters: editParameters,
      async execute(_id: string, { path, oldText, newText }: EditInput) {
        const target = await workspacePath(root, path);
        const content = await readFile(target, "utf8");
        const first = content.indexOf(oldText);
        if (first === -1) throw new Error("oldText was not found in the file.");
        if (content.indexOf(oldText, first + oldText.length) !== -1) throw new Error("oldText occurs more than once; provide a unique fragment.");
        await writeFile(target, `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`, "utf8");
        return textResult(`Edited ${path}.`);
      },
    },
    {
      name: "bash",
      label: "Run bash command",
      description: "Run a bash command with the workspace as its working directory. Use for builds, tests, and other development commands.",
      parameters: bashParameters,
      async execute(_id: string, { command, timeoutMs = 30_000 }: BashInput, signal?: AbortSignal) {
        const result = await execFileAsync("bash", ["-lc", command], {
          cwd: root,
          timeout: timeoutMs,
          maxBuffer: MAX_COMMAND_OUTPUT,
          signal,
        }).catch((error: unknown) => {
          const failure = error as { stdout?: string; stderr?: string; message: string };
          throw new Error(truncate([failure.stdout, failure.stderr, failure.message].filter(Boolean).join("\n")));
        });
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return textResult(truncate(output) || "Command completed with no output.");
      },
    },
  ];
  // Pi validates each tool's TypeBox schema before calling execute. The tools
  // intentionally have different parameter schemas, so their heterogeneous
  // tuple is widened here for the Agent's tool registry.
  return tools as unknown as AgentTool<any>[];
}
