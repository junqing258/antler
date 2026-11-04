import { isBuiltinAgent } from "./builtin-agents.js";
export class PlatformError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    readonly statusCode = 409,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
export type AuthContext = { userId: string; authMode: "local" | "supabase" };
export const canEdit = (row: { ownerId: string; id?: string }, auth: AuthContext) =>
  auth.authMode === "local" ||
  (!!auth.userId && (row.ownerId === auth.userId || !!(row.id && isBuiltinAgent(row.id))));
export const canRead = (
  row: { ownerId: string; status: string; id?: string },
  auth: AuthContext,
) => canEdit(row, auth) || row.status === "published";
export function requireOwner(
  row: { ownerId: string; id?: string } | null,
  auth: AuthContext,
) {
  if (!row) throw new PlatformError("not_found", 404);
  if (!canEdit(row, auth)) throw new PlatformError("forbidden", 403);
}
