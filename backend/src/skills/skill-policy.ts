import { createHash } from "node:crypto";
import type {
  LoadedSkill,
  SkillDiagnostic,
  SkillPolicy,
  SkillSnapshot,
} from "./types.js";
export class SkillPolicyError extends Error {
  constructor(readonly code = "skill_not_found") {
    super(code);
  }
}
export function createSkillSnapshot(
  workspaceRoot: string,
  policy: SkillPolicy,
  catalog: { skills: LoadedSkill[]; diagnostics: SkillDiagnostic[] },
): SkillSnapshot {
  if (policy.mode === "disabled")
    return {
      workspaceRoot,
      policy,
      catalogFingerprint: "sha256:disabled",
      skills: [],
      diagnostics: [],
    };
  const requested =
    policy.mode === "selected"
      ? policy.skillIds
      : catalog.skills.map((s) => s.id);
  const skills = requested
    .map((id) => catalog.skills.find((s) => s.id === id))
    .filter(Boolean) as LoadedSkill[];
  if (skills.length !== requested.length) throw new SkillPolicyError();
  return {
    workspaceRoot,
    policy,
    skills,
    diagnostics: catalog.diagnostics,
    catalogFingerprint: `sha256:${createHash("sha256")
      .update(
        skills
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((s) => `${s.id}:${s.fingerprint}`)
          .join("\n"),
      )
      .digest("hex")}`,
  };
}
