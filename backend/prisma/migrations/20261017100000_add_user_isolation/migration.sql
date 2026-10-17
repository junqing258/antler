-- 业务数据按 Supabase 用户隔离：local 模式写入空字符串。
ALTER TABLE "runs" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "scheduled_tasks" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "task_executions" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "runs_userId_createdAt_idx" ON "runs"("userId", "createdAt");
CREATE INDEX "scheduled_tasks_userId_createdAt_idx" ON "scheduled_tasks"("userId", "createdAt");
