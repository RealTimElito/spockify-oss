/**
 * IDE opt-in plugin session. Missing/broken command is not this file's job —
 * the caller already fell back via resolveHarnessOrFallback.
 */
import {
  runPluginHarness,
  type HarnessYaml,
} from '@spockify/harness-host';
import type { AgentRuntimeEvent } from './types';

export async function runIdePlugin(opts: {
  harness: HarnessYaml;
  cwd: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent: (ev: AgentRuntimeEvent) => void;
}): Promise<{ ok: boolean; error?: string }> {
  const baseUrl =
    process.env.SPOCKIFY_BASE_URL || process.env.OPENAI_BASE_URL || '';
  const apiKey =
    process.env.SPOCKIFY_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LITELLM_MASTER_KEY ||
    '';
  return runPluginHarness({
    harness: opts.harness,
    cwd: opts.cwd,
    transport: { baseUrl, apiKey, model: opts.model },
    policy: { mode: 'build', maxTurns: opts.maxTurns ?? 48 },
    messages: opts.messages,
    signal: opts.signal,
    onEvent: (ev) => {
      const type = String(ev.type || ev.t || ev.op || '');
      if (type === 'text') {
        opts.onEvent({ type: 'text', content: String(ev.content || '') });
      } else if (type === 'toolStart') {
        const args =
          ev.arguments && typeof ev.arguments === 'object'
            ? (ev.arguments as Record<string, unknown>)
            : {};
        opts.onEvent({
          type: 'toolStart',
          id: String(ev.id || ev.name || 'tool'),
          name: String(ev.name || 'tool'),
          arguments: args,
        });
      } else if (type === 'toolResult') {
        opts.onEvent({
          type: 'toolResult',
          id: String(ev.id || ev.name || 'tool'),
          name: String(ev.name || 'tool'),
          ok: ev.ok !== false,
          content: String(ev.content || ''),
          error: ev.error ? String(ev.error) : undefined,
        });
      } else if (type === 'error') {
        opts.onEvent({
          type: 'error',
          message: String(ev.message || ev.error || 'plugin error'),
        });
      } else if (type === 'done') {
        opts.onEvent({ type: 'done', cancelled: Boolean(ev.cancelled) });
      }
    },
  });
}
