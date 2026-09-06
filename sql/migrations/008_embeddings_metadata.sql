-- Embeddings metadata (vectors stored by OpenWebUI/RAG; we track provenance).

CREATE TABLE IF NOT EXISTS embeddings_metadata (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type TEXT NOT NULL
        CHECK (source_type IN ('document', 'message', 'web_page', 'chunk')),
    source_id TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    model TEXT NOT NULL,
    dimension INTEGER,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    content_preview TEXT,
    storage_uri TEXT,
    thread_id TEXT,
    conversation_id UUID REFERENCES conversations (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (collection_name, source_type, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_collection
    ON embeddings_metadata (collection_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_embeddings_source
    ON embeddings_metadata (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_thread
    ON embeddings_metadata (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_embeddings_hash
    ON embeddings_metadata (content_hash) WHERE content_hash IS NOT NULL;

COMMENT ON TABLE embeddings_metadata IS
    'Metadata for RAG embeddings; actual vectors live in OpenWebUI tables or external store.';
