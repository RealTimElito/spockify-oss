-- Tool invocations (web search via SearXNG, future tools).

CREATE TABLE IF NOT EXISTS tool_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations (id) ON DELETE SET NULL,
    thread_id TEXT,
    message_id UUID REFERENCES messages (id) ON DELETE SET NULL,
    agent_run_id UUID REFERENCES agent_runs (id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    tool_input JSONB NOT NULL DEFAULT '{}'::jsonb,
    tool_output JSONB,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    search_query TEXT,
    search_engine TEXT DEFAULT 'searxng',
    result_count INTEGER,
    latency_ms INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_thread
    ON tool_calls (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name
    ON tool_calls (tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_web_search
    ON tool_calls (search_query, created_at DESC)
    WHERE tool_name = 'web_search' AND search_query IS NOT NULL;

COMMENT ON TABLE tool_calls IS
    'Tool execution log; web_search rows capture SearXNG queries and result counts.';
