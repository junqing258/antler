import { parse } from "yaml";
import type { Skill } from "./types.js";

export class SkillMetadataError extends Error {}

/** Preserve the frontmatter and body semantics of Pi 0.84.3. */
export function parseSkill(
  raw: string,
  directoryName: string,
  filePath: string,
): Skill {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let frontmatter: Record<string, unknown> = {};
  let body = normalized;
  const endIndex = normalized.startsWith("---")
    ? normalized.indexOf("\n---", 3)
    : -1;
  if (endIndex !== -1) {
    const value: unknown = parse(normalized.slice(4, endIndex));
    if (value !== null && value !== undefined) {
      if (typeof value !== "object" || Array.isArray(value))
        throw new SkillMetadataError("Skill 元数据无效。");
      frontmatter = value as Record<string, unknown>;
    }
    body = normalized.slice(endIndex + 4).trim();
  }
  const name =
    typeof frontmatter.name === "string" && frontmatter.name
      ? frontmatter.name
      : directoryName;
  const description = frontmatter.description;
  if (
    name !== directoryName ||
    name.length > 64 ||
    !/^[a-z0-9-]+$/.test(name) ||
    name.startsWith("-") ||
    name.endsWith("-") ||
    name.includes("--") ||
    typeof description !== "string" ||
    !description.trim() ||
    description.length > 1024
  ) {
    throw new SkillMetadataError("Skill 元数据无效。");
  }
  return {
    name,
    description,
    content: body,
    filePath,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  };
}

export function formatSkillInvocation(skill: Skill): string {
  // node:path dirname would change the model-visible skill:// URI on Windows.
  const path = skill.filePath.replace(/[\\/]+$/, "");
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const directory =
    index === 2 && path[1] === ":"
      ? path.slice(0, 3)
      : index <= 0
        ? "/"
        : path.slice(0, index);
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${directory}.\n\n${skill.content}\n</skill>`;
}
