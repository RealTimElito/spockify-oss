-- Messages within a conversation thread.

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    sequence_num INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    model TEXT,
    parent_message_id UUID REFERENCES messages (id) ON DELETE SET NULL,
    tokens_prompt INTEGER,
    tokens_completion INTEGER,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (conversation_id, sequence_num)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
    ON messages (conversation_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id
    ON messages (thread_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_messages_created
    ON messages (created_at DESC);

COMMENT ON TABLE messages IS
    'Ordered message history per thread for conversation resume.';
