-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('text', 'file', 'directory');

-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('pending', 'indexing', 'ready', 'degraded', 'failed', 'archived');

-- CreateEnum
CREATE TYPE "KnowledgeJobStatus" AS ENUM ('queued', 'scanning', 'parsing', 'chunking', 'committing', 'succeeded', 'failed', 'cancelled', 'interrupted');

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
CREATE TABLE "run_knowledge_hits" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chunkId" TEXT,
    "citationKey" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "lexicalScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "locatorSnapshot" JSONB NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_knowledge_hits_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "retrievalConfig" JSONB NOT NULL,
    "indexVersion" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "uri" TEXT,
    "displayName" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'pending',
    "contentHash" TEXT,
    "lastIndexedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "logicalPath" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "headingPath" TEXT,
    "locator" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "chunkerVersion" INTEGER NOT NULL,
    "indexVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_ingestion_jobs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "KnowledgeJobStatus" NOT NULL DEFAULT 'queued',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "errorCode" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_ingestion_events" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_ingestion_events_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "run_knowledge_hits_runId_citationKey_key" ON "run_knowledge_hits"("runId", "citationKey");

-- CreateIndex
CREATE INDEX "run_events_runId_seq_idx" ON "run_events"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "run_events_runId_seq_key" ON "run_events"("runId", "seq");

-- CreateIndex
CREATE INDEX "knowledge_bases_projectId_updatedAt_idx" ON "knowledge_bases"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "knowledge_sources_knowledgeBaseId_updatedAt_idx" ON "knowledge_sources"("knowledgeBaseId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_sourceId_logicalPath_key" ON "knowledge_documents"("sourceId", "logicalPath");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_documentId_ordinal_indexVersion_key" ON "knowledge_chunks"("documentId", "ordinal", "indexVersion");

-- CreateIndex
CREATE INDEX "knowledge_ingestion_jobs_sourceId_createdAt_idx" ON "knowledge_ingestion_jobs"("sourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_ingestion_events_jobId_seq_key" ON "knowledge_ingestion_events"("jobId", "seq");

-- CreateIndex
CREATE INDEX "scheduled_tasks_userId_createdAt_idx" ON "scheduled_tasks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "task_executions_taskId_startedAt_idx" ON "task_executions"("taskId", "startedAt");

-- AddForeignKey
ALTER TABLE "run_knowledge_hits" ADD CONSTRAINT "run_knowledge_hits_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_ingestion_jobs" ADD CONSTRAINT "knowledge_ingestion_jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_ingestion_events" ADD CONSTRAINT "knowledge_ingestion_events_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "knowledge_ingestion_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

