-- Clean up databases initialized before the internal knowledge module was removed.
-- Fresh databases no longer create these tables or enum types.
DROP TABLE IF EXISTS "run_knowledge_hits";
DROP TABLE IF EXISTS "knowledge_ingestion_events";
DROP TABLE IF EXISTS "knowledge_ingestion_jobs";
DROP TABLE IF EXISTS "knowledge_chunks";
DROP TABLE IF EXISTS "knowledge_documents";
DROP TABLE IF EXISTS "knowledge_sources";
DROP TABLE IF EXISTS "knowledge_bases";

DROP TYPE IF EXISTS "KnowledgeJobStatus";
DROP TYPE IF EXISTS "KnowledgeSourceStatus";
DROP TYPE IF EXISTS "KnowledgeSourceType";
