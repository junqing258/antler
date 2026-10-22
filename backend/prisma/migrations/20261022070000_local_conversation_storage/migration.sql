-- Legacy payloads remain available until each conversation has been copied to disk.
ALTER TABLE "conversations" ADD COLUMN "messageStorage" TEXT NOT NULL DEFAULT 'database';
