/** Shared coding-agent types for @spockify/harness. */

/** Product modes. plan≈ask (read-only); build≈agent (writes). */
export type AgentMode = 'ask' | 'agent' | 'plan' | 'build';

export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'heavy';

export type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCallRequest[];
  /** Archive-only chain-of-thought. Never sent to the model. */
  reasoning?: string;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolCallResult = {
  ok: boolean;
  content: string;
  error?: string;
  /** Structured fail-object when run_tests is red. */
  failObject?: Record<string, unknown>;
};

export type ToolParameterSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export type UnifiedToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  mutates: boolean;
};

export type ToolExecutionContext = {
  cwd: string;
  signal?: AbortSignal;
  mode: AgentMode;
  yolo: boolean;
  /** Paths read this session (write guard). */
  readSet?: Set<string>;
  /** Durable todos for todowrite. */
  todos?: TodoItem[];
  /** Session grants (Phase 2). */
  permissions?: import('./permissions').PermissionMemory;
  /** yoloGrants: none | session | all */
  yoloGrants?: 'none' | 'session' | 'all';
  writeRequiresRead?: boolean;
  /** Active skill bodies injected into prompt. */
  activeSkills?: string[];
  confirm?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  /** ask_user bridge */
  askUser?: (prompt: string) => Promise<string>;
  onEvent?: (e: HarnessEvent) => void;
};

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<ToolCallResult>;

export type RegisteredTool = UnifiedToolDefinition & { execute: ToolExecutor };

export type TodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
};

export type HarnessPolicy = {
  mode: AgentMode;
  yolo?: boolean;
  maxTurns?: number;
  parallelTools?: boolean;
  loopWindow?: number;
  loopThreshold?: number;
  writeRequiresRead?: boolean;
  editCascade?: boolean;
  compactAtTokens?: number;
  thinking?: ThinkingEffort;
  yoloGrants?: 'none' | 'session' | 'all';
  skillsDir?: string;
  /**
   * Mid-think coding spawn (structured task / SPAWN_CODING only).
   * Default on for build/agent unless SPOCKIFY_CODING_SPAWN=0. Children must be false.
   */
  codingSpawn?: boolean;
  /** When true, Auto keeps policy.thinking instead of the session picker's. */
  userPinnedThink?: boolean;
};

export type HarnessSession = {
  messages: AgentMessage[];
  tick: number;
  readSet: string[];
  toolLog: string[];
  todos: TodoItem[];
  napkin?: string;
  activeSkillIds?: string[];
  /** Up to 2 skill bodies for the system prompt. */
  skillBodies?: string[];
  cwd: string;
  model: string;
  /** After first apply_patch/write/edit, Auto may not swap the worker. */
  pinLocked?: boolean;
};

/** Frozen event schema (docs/HARNESS.md). */
export type HarnessEvent =
  | { type: 'status'; text: string }
  | { type: 'model'; requested: string; resolved?: string }
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'toolStart'; id: string; name: string; arguments: Record<string, unknown> }
  | {
      type: 'toolResult';
      id: string;
      name: string;
      ok: boolean;
      content: string;
      error?: string;
    }
  | { type: 'toolKilled'; id: string; name: string }
  | { type: 'loopWarning'; signature: string; count: number }
  | { type: 'compact'; ok: boolean }
  | { type: 'taskSpawn'; id: string; kind: string }
  | { type: 'taskDone'; id: string }
  | { type: 'askUser'; prompt: string }
  | { type: 'agents'; run: Record<string, unknown> }
  | { type: 'done'; cancelled?: boolean }
  | { type: 'error'; message: string };

/** Legacy CLI event alias. */
export type AgentRuntimeEvent = HarnessEvent;

export function normalizeMode(mode: AgentMode): 'ask' | 'agent' {
  if (mode === 'plan' || mode === 'ask') return 'ask';
  return 'agent';
}

export function isReadOnlyMode(mode: AgentMode): boolean {
  return normalizeMode(mode) === 'ask';
}
