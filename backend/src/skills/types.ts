export type Skill = {
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation: boolean;
};

export type SkillScope = "workspace" | "user" | "bundled" | "platform";
export type LoadedSkill = {
  id: string;
  skill: Skill;
  scope: SkillScope;
  directory: string;
  modelUri: string;
  fingerprint: string;
  directoryFingerprint?: string;
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
  contextFingerprint: string;
  skills: readonly LoadedSkill[];
  diagnostics: readonly SkillDiagnostic[];
};
export const DISABLED_SKILL_SNAPSHOT: SkillSnapshot = {
  workspaceRoot: "",
  policy: { mode: "disabled" },
  catalogFingerprint: "sha256:disabled",
  contextFingerprint: "sha256:disabled",
  skills: [],
  diagnostics: [],
};

export type PlatformSkillRow = {
  id: string;
  name: string;
  description: string;
  directory: string;
  fingerprint: string;
  disableModelInvocation?: boolean;
};
