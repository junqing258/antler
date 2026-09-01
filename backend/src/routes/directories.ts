import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

function isInside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function listWorkspaceDirectories(
  workspaceRoot: string,
  requestedPath = "",
) {
  if (isAbsolute(requestedPath)) throw new Error("目录路径必须相对于工作区。");

  const root = await realpath(resolve(workspaceRoot));
  const candidate = resolve(root, requestedPath);
  if (!isInside(root, candidate)) throw new Error("目录路径不能超出工作区。");

  const current = await realpath(candidate);
  if (!isInside(root, current) || !(await stat(current)).isDirectory()) {
    throw new Error("目录不存在或不在工作区内。");
  }

  const path = relative(root, current);
  const entries = (await readdir(current, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(path, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const parent = path ? relative(root, resolve(current, "..")) : null;
  return { root, path, workingDirectory: current, parent, directories: entries };
}

export function registerDirectoryRoutes(
  app: FastifyInstance,
  workspaceRoot: string,
) {
  app.get<{ Querystring: { path?: string } }>(
    "/api/directories",
    async (request, reply) => {
      try {
        return reply.send(
          await listWorkspaceDirectories(workspaceRoot, request.query.path ?? ""),
        );
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "无法读取目录。",
        });
      }
    },
  );
}
