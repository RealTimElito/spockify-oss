-- Model routing decisions from Gemma orchestrator / LiteLLM router.

CREATE TABLE IF NOT EXISTS model_routing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT,
    thread_id TEXT,
    conversation_id UUID REFERENCES conversations (id) ON DELETE SET NULL,
    agent_run_id UUID REFERENCES agent_runs (id) ON DELETE SET NULL,
    orchestrator_model TEXT NOT NULL DEFAULT 'gemma3:12b',
    selected_model TEXT NOT NULL,
    candidate_models TEXT[],
    task_type TEXT,
    confidence REAL,
    reasoning TEXT,
    prompt_template TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_routing_logs_created
    ON model_routing_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_logs_thread
    ON model_routing_logs (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_logs_request
    ON model_routing_logs (request_id);
CREATE INDEX IF NOT EXISTS idx_routing_logs_selected_model
    ON model_routing_logs (selected_model, created_at DESC);

COMMENT ON TABLE model_routing_logs IS
    'Audit trail of orchestrator routing decisions for debugging and analytics.';
