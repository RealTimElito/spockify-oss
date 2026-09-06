export type AgentMode = 'ask' | 'agent';

export type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCallRequest[];
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
  confirm?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
};

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<ToolCallResult>;

export type RegisteredTool = UnifiedToolDefinition & { execute: ToolExecutor };

export type AgentRuntimeEvent =
  | { type: 'status'; text: string }
  | { type: 'model'; requested: string; resolved?: string }
  | { type: 'text'; content: string }
  | { type: 'toolStart'; id: string; name: string; arguments: Record<string, unknown> }
  | {
      type: 'toolResult';
      id: string;
      name: string;
      ok: boolean;
      content: string;
      error?: string;
    }
  | { type: 'done'; cancelled?: boolean }
  | { type: 'error'; message: string };
