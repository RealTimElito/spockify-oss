/**
 * Bounded in-loop compaction. Keeps the system prompt, the first user task,
 * the latest user instruction, and a short tail. Older tool dumps become one summary.
 */
import type { AgentMessage, TodoItem } from './types';

/** ~24k tokens before a turn compacts. Override with policy.compactAtTokens. */
export const DEFAULT_COMPACT_TOKENS = 24_000;

const CHARS_PER_TOKEN = 4;
const SUMMARY_LINES = 24;
const LINE_CHARS = 160;

export function estimateMessageTokens(messages: readonly AgentMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += (message.content || '').length + (message.name || '').length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function oneLine(message: AgentMessage): string {
  const body = (message.content || '').replace(/\s+/g, ' ').trim().slice(0, LINE_CHARS);
  const who = message.role === 'tool' ? `tool ${message.name || 'tool'}` : message.role;
  return body ? `${who}: ${body}` : who;
}

function formatSummary(lines: string[], todos: readonly TodoItem[] | undefined): string {
  const kept = lines.slice(-SUMMARY_LINES);
  const omitted = lines.length - kept.length;
  const parts = ['[Earlier turns compacted. Task and latest instruction are kept.]'];
  if (omitted > 0) parts.push(`(${omitted} older lines omitted)`);
  parts.push(...kept);
  if (todos?.length) {
    parts.push('Todos:');
    for (const todo of todos) {
      parts.push(`- [${todo.status}] ${todo.content}`);
    }
  }
  return parts.join('\n');
}

/**
 * Compact when over budget. Returns the same array when nothing changes.
 * Never drops the first user message or the latest user message.
 */
export function compactThread(
  messages: AgentMessage[],
  opts: {
    maxTokens: number;
    keepRecent?: number;
    todos?: readonly TodoItem[];
  },
): { messages: AgentMessage[]; compacted: boolean } {
  const maxTokens = opts.maxTokens;
  if (maxTokens <= 0 || estimateMessageTokens(messages) <= maxTokens) {
    return { messages, compacted: false };
  }
  const keepRecent = Math.max(1, opts.keepRecent ?? 6);
  const userIndexes: number[] = [];
  let systemIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const role = messages[i]?.role;
    if (role === 'system' && systemIndex < 0) systemIndex = i;
    if (role === 'user') userIndexes.push(i);
  }
  const mustKeep = new Set<number>();
  if (systemIndex >= 0) mustKeep.add(systemIndex);
  const firstUser = userIndexes[0];
  const lastUser = userIndexes[userIndexes.length - 1];
  if (firstUser !== undefined) mustKeep.add(firstUser);
  if (lastUser !== undefined) mustKeep.add(lastUser);
  for (let i = Math.max(0, messages.length - keepRecent); i < messages.length; i++) {
    mustKeep.add(i);
  }
  // A kept tool result needs the assistant turn that requested it.
  for (const index of [...mustKeep]) {
    if (messages[index]?.role !== 'tool') continue;
    for (let j = index - 1; j >= 0; j--) {
      const role = messages[j]?.role;
      if (role === 'assistant') {
        mustKeep.add(j);
        break;
      }
      if (role === 'user' || role === 'system') break;
    }
  }

  const summaryLines: string[] = [];
  const kept: AgentMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (mustKeep.has(i)) {
      if (message.role !== 'system') kept.push(message);
      continue;
    }
    summaryLines.push(oneLine(message));
  }

  const out: AgentMessage[] = [];
  if (systemIndex >= 0) out.push(messages[systemIndex]!);
  if (summaryLines.length || opts.todos?.length) {
    out.push({
      role: 'user',
      content: formatSummary(summaryLines, opts.todos),
    });
  }
  out.push(...kept);
  return { messages: out, compacted: true };
}
