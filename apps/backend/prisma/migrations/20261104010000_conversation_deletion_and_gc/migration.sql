-- 会话删除恢复任务与垃圾回收候选（docs/21 §4.4/§4.5）。
CREATE TABLE "conversation_deletion_tasks" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marker" TEXT NOT NULL,
    "keys" JSONB,
    "stage" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_deletion_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_deletion_tasks_stage_createdAt_idx" ON "conversation_deletion_tasks"("stage", "createdAt");

CREATE TABLE "storage_garbage_candidates" (
    "key" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_garbage_candidates_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "storage_garbage_candidates_firstSeenAt_idx" ON "storage_garbage_candidates"("firstSeenAt");

-- 删除任务与 GC 候选均为 backend 专用平台表，与其余平台表一致启用 RLS。
ALTER TABLE "public"."conversation_deletion_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."storage_garbage_candidates" ENABLE ROW LEVEL SECURITY;
