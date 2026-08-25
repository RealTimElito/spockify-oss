import { randomBytes } from 'crypto';
import type { AgentMessage } from '../runtime/types';
import type { ComposerSession, ComposerTurn, FilePatch } from './types';

export function createComposerSession(): ComposerSession {
  return {
    id: randomBytes(8).toString('hex'),
    turns: [],
    agentMessages: [],
    fileTouchList: [],
    pendingPatches: [],
  };
}

export function mergeFileTouchList(
  session: ComposerSession,
  patches: FilePatch[],
): void {
  const seen = new Set(session.fileTouchList);
  for (const p of patches) {
    const path = p.path.replace(/^\.\//, '');
    if (!seen.has(path)) {
      seen.add(path);
      session.fileTouchList.push(path);
    }
  }
}

export function recordTurn(
  session: ComposerSession,
  userContent: string,
  assistantContent: string,
  patches: FilePatch[],
): void {
  const user: ComposerTurn = { role: 'user', content: userContent };
  const assistant: ComposerTurn = {
    role: 'assistant',
    content: assistantContent,
  };
  session.turns.push(user, assistant);
  session.pendingPatches = patches;
  mergeFileTouchList(session, patches);
}

/**
 * Persist runtime transcript for the next user revise turn.
 * Drops system (re-injected each run via systemPrompt).
 */
export function recordAgentTranscript(
  session: ComposerSession,
  messages: AgentMessage[],
): void {
  session.agentMessages = messages.filter((m) => m.role !== 'system');
}

/** History for the next AgentRuntime.run — tool-aware when available. */
export function historyForNextTurn(session: ComposerSession): AgentMessage[] {
  if (session.agentMessages?.length) {
    return [...session.agentMessages];
  }
  return session.turns.map((t) => ({
    role: t.role as 'user' | 'assistant',
    content: t.content,
  }));
}
