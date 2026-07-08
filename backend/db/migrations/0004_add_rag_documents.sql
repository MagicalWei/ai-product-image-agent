-- Migration: 0004_add_rag_documents
-- Description: Add pgvector extension and rag_documents table for RAG knowledge base

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create rag_documents table
CREATE TABLE IF NOT EXISTS rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
    category VARCHAR(64),     -- Knowledge category: prompt_template/style_guide/platform_rule/copywriting
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index on category for filtered queries
CREATE INDEX IF NOT EXISTS idx_rag_documents_category
    ON rag_documents (category);

-- IVFFlat index on embedding for cosine similarity search
-- Note: IVFFlat requires some data to be present before creation.
-- For an empty table, the index is created but only becomes effective after data insertion.
-- If the table has < 100 rows, consider using exact search without index.
CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding
    ON rag_documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
