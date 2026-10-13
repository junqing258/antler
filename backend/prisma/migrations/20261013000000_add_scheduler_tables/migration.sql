CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryDelay" INTEGER NOT NULL DEFAULT 60000,
    "timeout" INTEGER NOT NULL DEFAULT 300000,
    "runAt" DATETIME,
    "lastExecutedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "task_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "duration" INTEGER,
    "result" JSONB,
    "error" TEXT,
    "retryAttempt" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "scheduled_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "task_executions_taskId_startedAt_idx" ON "task_executions"("taskId", "startedAt");
