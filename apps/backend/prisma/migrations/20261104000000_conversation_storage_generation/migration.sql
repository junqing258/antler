-- 会话存储介质迁移到腾讯云 COS（cos-v1）：新增正文提交序号的诊断 hint 字段。
ALTER TABLE "conversations" ADD COLUMN "storageGeneration" INTEGER NOT NULL DEFAULT 0;
