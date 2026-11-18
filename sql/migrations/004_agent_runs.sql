-- Agent execution runs (orchestrator, tool loops, multi-step agents).

CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations (id) ON DELETE SET NULL,
    thread_id TEXT,
    run_id TEXT NOT NULL UNIQUE,
    agent_name TEXT NOT NULL DEFAULT 'spockify',
    model TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_latency_ms INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread
    ON agent_runs (thread_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation
    ON agent_runs (conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status
    ON agent_runs (status) WHERE status IN ('pending', 'running');

COMMENT ON TABLE agent_runs IS
    'Tracks agent/orchestrator execution runs linked to conversation threads.';
