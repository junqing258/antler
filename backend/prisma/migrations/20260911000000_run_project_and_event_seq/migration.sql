-- A project ID is initially an opaque client-side key. Existing local runs
-- predate project support and therefore belong to the default project.
ALTER TABLE "runs" ADD COLUMN "projectId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "runs_projectId_createdAt_idx" ON "runs"("projectId", "createdAt");

-- SSE event IDs are per-run sequence numbers, not the previous global row ID.
ALTER TABLE "run_events" ADD COLUMN "seq" INTEGER;
UPDATE "run_events"
SET "seq" = (
  SELECT COUNT(*) FROM "run_events" AS earlier
  WHERE earlier."runId" = "run_events"."runId"
    AND earlier."id" <= "run_events"."id"
);
CREATE UNIQUE INDEX "run_events_runId_seq_key" ON "run_events"("runId", "seq");
CREATE INDEX "run_events_runId_seq_idx" ON "run_events"("runId", "seq");
