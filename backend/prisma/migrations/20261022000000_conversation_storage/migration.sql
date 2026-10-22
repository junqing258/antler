-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "executionConfig" JSONB,
ADD COLUMN     "requestHash" TEXT;

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "executionConfig" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "titleSource" TEXT NOT NULL DEFAULT 'fallback',
    "checkpoint" JSONB,
    "contextState" TEXT NOT NULL DEFAULT 'not_restored',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "activeRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "appliedEventId" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_sync_states" (
    "userId" TEXT NOT NULL,
    "lastChangeId" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversation_sync_states_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "conversation_changes" (
    "userId" TEXT NOT NULL,
    "changeId" INTEGER NOT NULL,
    "conversationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_changes_pkey" PRIMARY KEY ("userId","changeId")
);

-- CreateIndex
CREATE INDEX "conversations_userId_lastMessageAt_id_idx" ON "conversations"("userId", "lastMessageAt", "id");

-- CreateIndex
CREATE INDEX "conversations_userId_agentId_lastMessageAt_id_idx" ON "conversations"("userId", "agentId", "lastMessageAt", "id");

-- CreateIndex
CREATE INDEX "conversation_messages_userId_conversationId_seq_idx" ON "conversation_messages"("userId", "conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_conversationId_seq_key" ON "conversation_messages"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_runId_role_key" ON "conversation_messages"("runId", "role");

-- CreateIndex
CREATE INDEX "conversation_changes_createdAt_idx" ON "conversation_changes"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "runs_userId_clientRequestId_key" ON "runs"("userId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_sync_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_changes" ENABLE ROW LEVEL SECURITY;
