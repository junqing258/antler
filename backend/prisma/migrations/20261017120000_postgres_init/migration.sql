-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ScheduledTaskType" AS ENUM ('http', 'service', 'script');

-- CreateEnum
CREATE TYPE "TaskExecutionStatus" AS ENUM ('running', 'succeeded', 'failed', 'timeout');

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_events" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ScheduledTaskType" NOT NULL,
    "schedule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryDelay" INTEGER NOT NULL DEFAULT 60000,
    "timeout" INTEGER NOT NULL DEFAULT 300000,
    "runAt" TIMESTAMP(3),
    "lastExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_executions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL,
    "status" "TaskExecutionStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "result" JSONB,
    "error" TEXT,
    "retryAttempt" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "task_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runs_projectId_createdAt_idx" ON "runs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "runs_conversationId_createdAt_idx" ON "runs"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "runs_userId_createdAt_idx" ON "runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "run_events_runId_seq_idx" ON "run_events"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "run_events_runId_seq_key" ON "run_events"("runId", "seq");

-- CreateIndex
CREATE INDEX "scheduled_tasks_userId_createdAt_idx" ON "scheduled_tasks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "task_executions_taskId_startedAt_idx" ON "task_executions"("taskId", "startedAt");

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
