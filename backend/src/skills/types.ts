import type { Skill } from "@earendil-works/pi-agent-core";

export type SkillScope = "workspace" | "user";
export type LoadedSkill = {
  id: string;
  skill: Skill;
  scope: SkillScope;
  directory: string;
  modelUri: string;
  fingerprint: string;
};
export type SkillDiagnostic = {
  code: string;
  name?: string;
  scope: SkillScope;
  message: string;
};
export type SkillPolicy =
  | { mode: "disabled" }
  | { mode: "auto" }
  | { mode: "selected"; skillIds: string[] };
export type SkillSnapshot = {
  workspaceRoot: string;
  policy: SkillPolicy;
  catalogFingerprint: string;
  skills: readonly LoadedSkill[];
  diagnostics: readonly SkillDiagnostic[];
};
export const DISABLED_SKILL_SNAPSHOT: SkillSnapshot = {
  workspaceRoot: "",
  policy: { mode: "disabled" },
  catalogFingerprint: "sha256:disabled",
  skills: [],
  diagnostics: [],
};
