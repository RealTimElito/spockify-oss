import type { AgentMessage } from '../runtime/types';

export interface FilePatch {
  path: string;
  /** Full new file content from a path-tagged fence. */
  content: string;
}

export interface ComposerTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** How Composer stages multi-file Accept after a turn. */
export type ComposerReviewMode = 'panel' | 'tree' | 'prompt';

export interface ComposerSession {
  id: string;
  turns: ComposerTurn[];
  /**
   * Full AgentRuntime transcript across *user* turns (assistant.tool_calls +
   * role:tool). Preferred over text-only `turns` when revising.
   */
  agentMessages?: AgentMessage[];
  /** Workspace-relative paths touched across turns (deduped, order preserved). */
  fileTouchList: string[];
  pendingPatches: FilePatch[];
  shadowRoot?: string;
}
