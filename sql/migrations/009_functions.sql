-- Triggers and helpers for conversation resume and message ordering.

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversations_updated ON conversations;
CREATE TRIGGER trg_conversations_updated
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION bump_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET message_count = message_count + 1,
        last_message_at = NEW.created_at,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_bump_conversation ON messages;
CREATE TRIGGER trg_messages_bump_conversation
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION bump_conversation_on_message();

-- Upsert conversation by thread_id (used when OpenWebUI creates/resumes a chat).
CREATE OR REPLACE FUNCTION upsert_conversation(
    p_thread_id TEXT,
    p_user_id TEXT DEFAULT NULL,
    p_title TEXT DEFAULT NULL,
    p_model_used TEXT DEFAULT NULL,
    p_external_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO conversations (thread_id, user_id, title, model_used, external_id)
    VALUES (
        p_thread_id,
        p_user_id,
        p_title,
        p_model_used,
        COALESCE(p_external_id, p_thread_id)
    )
    ON CONFLICT (thread_id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, conversations.user_id),
        title = COALESCE(EXCLUDED.title, conversations.title),
        model_used = COALESCE(EXCLUDED.model_used, conversations.model_used),
        updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Fetch recent messages for thread resume (ordered chronologically).
CREATE OR REPLACE FUNCTION get_thread_messages(
    p_thread_id TEXT,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    id UUID,
    role TEXT,
    content TEXT,
    model TEXT,
    sequence_num INTEGER,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT m.id, m.role, m.content, m.model, m.sequence_num, m.created_at
    FROM messages m
    WHERE m.thread_id = p_thread_id
    ORDER BY m.sequence_num DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
