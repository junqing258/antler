-- CreateTable
CREATE TABLE "skill_files" (
    "skillId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" BYTEA NOT NULL,

    CONSTRAINT "skill_files_pkey" PRIMARY KEY ("skillId","path")
);

-- AddForeignKey
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Skill files hold platform skill content, backend-only like the rest of the platform tables.
ALTER TABLE "public"."skill_files" ENABLE ROW LEVEL SECURITY;
