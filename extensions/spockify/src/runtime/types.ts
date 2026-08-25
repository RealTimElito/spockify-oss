/**
 * Phase 1 agent runtime contracts — shared by Chat, Composer, Terminal, remote tools.
 * @see docs/SPOCKIFY_IDE_PHASE1_RUNTIME_PLAN.md
 */

export type AgentMode = 'ask' | 'agent' | 'strict';

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'cancelled'
  | 'done'
  | 'error';

export type ToolSource = 'mcp' | 'terminal' | 'apply' | 'remote' | 'builtin';

/** OpenAI multimodal content (string or text/image_url parts). */
export type AgentContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

export type AgentContent = string | AgentContentPart[];

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: AgentContent;
  /** Present when role === 'tool' */
  toolCallId?: string;
  name?: string;
  /**
   * OpenAI-shaped tool calls when role === 'assistant'.
   * Required by providers when subsequent messages use role:tool + tool_call_id.
   */
  toolCalls?: ToolCallRequest[];
  /** Model that produced this assistant message when known. */
  model?: string;
}

export interface ToolParameterSchema {
  type?: string;
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface UnifiedToolDefinition {
  /** Stable id, e.g. terminal_run, apply_patch, mcp__fs__list */
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  mutates: boolean;
  source: ToolSource;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  ok: boolean;
  content: string;
  error?: string;
  /** Checkpoint id when ApplyService recorded one */
  checkpointId?: string;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<ToolCallResult>;

export interface ToolExecutionContext {
  signal?: AbortSignal;
  sessionId: string;
  mode: AgentMode;
  /**
   * Cursor-like composer UI mode for this turn (Plan/Debug/Multitask/…).
   * Used for Plan mutation gates beyond runtime ask/agent/strict.
   */
  composerUiMode?: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask' | 'strict';
  /** When composerUiMode is plan, mutating tools stay blocked until approved. */
  planApproved?: boolean;
  output?: { appendLine(line: string): void };
}

export interface RegisteredTool extends UnifiedToolDefinition {
  execute: ToolExecutor;
}

export type AgentRuntimeEvent =
  | { type: 'status'; text: string; status?: SessionStatus }
  | { type: 'text'; content: string }
  | { type: 'model'; model: string }
  | { type: 'usage'; usage: Record<string, number> }
  | {
      type: 'toolStart';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'toolResult';
      id: string;
      name: string;
      ok: boolean;
      content: string;
      error?: string;
      checkpointId?: string;
    }
  | { type: 'done'; cancelled?: boolean }
  | { type: 'error'; message: string };

export interface AgentRunOptions {
  model: string;
  mode: AgentMode;
  /** Extra system instructions (surface-specific). */
  systemPrompt?: string;
  messages: AgentMessage[];
  /** Max model↔tool iterations. */
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentRuntimeEvent) => void;
  /**
   * When set, SessionManager.pause(sessionId) blocks between turns until resume.
   * Cancel still aborts via signal / SessionManager.cancel.
   */
  sessionId?: string;
  /** Optional extra request fields passed to chat completions. */
  requestExtras?: Record<string, unknown>;
}

export interface AgentRunResult {
  messages: AgentMessage[];
  status: SessionStatus;
  cancelled: boolean;
  error?: string;
}

export interface AgentSessionSnapshot {
  id: string;
  mode: AgentMode;
  status: SessionStatus;
  messages: AgentMessage[];
}
