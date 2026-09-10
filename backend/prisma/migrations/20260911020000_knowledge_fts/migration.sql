CREATE VIRTUAL TABLE "knowledge_chunks_fts" USING fts5(chunkId UNINDEXED, knowledgeBaseId UNINDEXED, title, text, tokenize='unicode61');
