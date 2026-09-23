import type { HarnessEvent, AgentMode as HarnessMode } from '@spockify/harness';
import type { AgentContent, AgentMode, AgentRuntimeEvent } from './types';

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

export function mapEvent(ev: HarnessEvent): AgentRuntimeEvent | null {
  switch (ev.type) {
    case 'status':
      return { type: 'status', text: ev.text, status: 'running' };
    case 'text':
      return { type: 'text', content: ev.content };
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
    case 'done':
      return { type: 'done', cancelled: ev.cancelled };
    case 'error':
      return { type: 'error', message: ev.message };
    default:
      return null;
  }
}
