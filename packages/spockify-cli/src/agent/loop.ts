import type { ThinkingMode } from '../thinking';
import type { ThinkingEffort } from '@spockify/harness';
import {
  runAgentTurn as runHarnessTurn,
  type AgentMessage,
  type AgentMode,
  type AgentRuntimeEvent,
  type PermissionMemory,
  type ToolRegistry,
} from '@spockify/harness';
import type { ModelTransport } from '@spockify/ide-client';

export {
  parseToolFences,
  resolveCliMaxTurns,
  DEFAULT_AGENT_MAX_TURNS,
  DEFAULT_ASK_MAX_TURNS,
  DEFAULT_YOLO_MAX_TURNS,
  AGENT_MAX_TURNS_HARD_CAP,
  runHarness,
} from '@spockify/harness';

function toEffort(t?: ThinkingMode): ThinkingEffort | undefined {
  return t;
}

/** CLI entry — delegates to @spockify/harness. */
export async function runAgentTurn(options: {
  transport: ModelTransport;
  registry: ToolRegistry;
  model: string;
  mode: AgentMode;
  thinking?: ThinkingMode;
  userPinnedThink?: boolean;
  messages: AgentMessage[];
  cwd: string;
  yolo: boolean;
  maxTurns?: number;
  signal?: AbortSignal;
  agentsMd?: string;
  skillBodies?: string[];
  systemPrompt?: string;
  allowCodingSpawn?: boolean;
  continueOnProse?: boolean;
  confirm?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  permissions?: PermissionMemory;
  onEvent?: (e: AgentRuntimeEvent) => void;
}): Promise<AgentMessage[]> {
  return runHarnessTurn({
    ...options,
    thinking: toEffort(options.thinking),
  });
}
