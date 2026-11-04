-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "SkillState" AS ENUM ('ready', 'broken', 'tampered');

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "agentFingerprint" TEXT,
ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "catalogFingerprint" TEXT,
ADD COLUMN     "skillPolicy" JSONB;

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "agentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("agentId","skillId")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "directory" TEXT NOT NULL,
    "state" "SkillState" NOT NULL DEFAULT 'ready',
    "disableModelInvocation" BOOLEAN NOT NULL DEFAULT false,
    "fileCount" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agents_status_publishedAt_idx" ON "agents"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "agents_ownerId_updatedAt_idx" ON "agents"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "agent_skills_skillId_idx" ON "agent_skills"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE INDEX "skills_ownerId_updatedAt_idx" ON "skills"("ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_skills" ENABLE ROW LEVEL SECURITY;
