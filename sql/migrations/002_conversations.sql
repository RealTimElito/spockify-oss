-- Conversations: thread_id enables "continue where I left off" across sessions.

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id TEXT NOT NULL UNIQUE,
    external_id TEXT UNIQUE,
    title TEXT,
    user_id TEXT,
    model_used TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived', 'deleted')),
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id
    ON conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
    ON conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message
    ON conversations (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_conversations_status
    ON conversations (status) WHERE status = 'active';

COMMENT ON TABLE conversations IS
    'Spockify conversation threads; thread_id maps to OpenWebUI chat IDs for resume.';
COMMENT ON COLUMN conversations.thread_id IS
    'Stable thread identifier for cross-session resume (OpenWebUI chat id).';
