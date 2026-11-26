import {
  doneReason,
  type HarnessEvent,
  type AgentMode as HarnessMode,
} from '@spockify/harness';
import type { AgentContent, AgentMode, AgentRuntimeEvent } from './types';

export type ThinkLevel =
  | 'off'
  | 'low'
  | 'medium'
  | 'high'
  | 'heavy'
  | 'auto';

export function contentToString(content: AgentContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export function toHarnessMode(mode: AgentMode): HarnessMode {
  return mode === 'ask' || mode === 'strict' ? 'ask' : 'agent';
}

/** Policy think string for runHarness (off stays off; else pass through). */
export function toHarnessThink(think: string): ThinkLevel {
  return (think === 'off' ? 'off' : think) as ThinkLevel;
}

/**
 * When Auto emits `auto → model think=level`, pin session + chrome.
 * Returns true if the status was an auto pin.
 */
export function applyAutoStatusPin(
  text: string,
  managed:
    | { resolvedModel?: string; resolvedThink?: string }
    | null
    | undefined,
  session: { model: string },
  harnessId: string,
  setActivityLabel: (label: string) => void,
  formatSessionPin: (args: {
    harnessId: string;
    model: string;
    thinking: string | undefined;
    auto: boolean;
  }) => string,
): boolean {
  if (!text.startsWith('auto → ')) return false;
  const m = /^auto → (\S+) think=(\S+)/.exec(text);
  if (!m || !managed) return false;
  managed.resolvedModel = m[1];
  managed.resolvedThink = m[2];
  session.model = m[1]!;
  setActivityLabel(
    formatSessionPin({
      harnessId,
      model: m[1]!,
      thinking: m[2],
      auto: true,
    }),
  );
  return true;
}

export function mapEvent(ev: HarnessEvent): AgentRuntimeEvent | null {
  switch (ev.type) {
    case 'status':
      return { type: 'status', text: ev.text, status: 'running' };
    case 'text':
      return { type: 'text', content: ev.content };
    case 'thinking':
      return { type: 'thinking', content: ev.content };
    case 'model':
      return { type: 'model', model: ev.resolved || ev.requested };
    case 'toolStart':
      return {
        type: 'toolStart',
        id: ev.id,
        name: ev.name,
        arguments: ev.arguments,
      };
    case 'toolResult':
      return {
        type: 'toolResult',
        id: ev.id,
        name: ev.name,
        ok: ev.ok,
        content: ev.content,
        error: ev.error,
      };
    case 'agents':
      return { type: 'agents', run: ev.run };
    case 'compact':
      return {
        type: 'status',
        text: ev.ok ? 'Compacted earlier turns' : 'Compaction failed',
        status: 'running',
      };
    case 'askUser':
      return {
        type: 'status',
        text: `Question: ${ev.prompt}`,
        status: 'running',
      };
    case 'done':
      return {
        type: 'done',
        cancelled: ev.cancelled,
        reason: doneReason(ev),
      };
    case 'error':
      return { type: 'error', message: ev.message };
    default:
      return null;
  }
}
