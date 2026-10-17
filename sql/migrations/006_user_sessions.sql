-- User sessions for resume context and last-active thread tracking.

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    thread_id TEXT,
    ip_address INET,
    user_agent TEXT,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
    ON user_sessions (user_id, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_thread
    ON user_sessions (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE user_sessions IS
    'Session state including last active thread for continue-where-left-off UX.';
COMMENT ON COLUMN user_sessions.thread_id IS
    'Most recently active conversation thread for this session.';
