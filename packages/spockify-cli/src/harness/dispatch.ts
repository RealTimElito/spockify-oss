/**
 * CLI session: run a yaml plugin when selected, otherwise the caller uses runHarness.
 * Missing command is already a kernel fallback from resolveHarnessOrFallback.
 */
import {
  resolveHarnessOrFallback,
  runPluginHarness,
} from '@spockify/harness-host';

export async function tryCliPlugin(opts: {
  cwd: string;
  harnessFlag?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent: (ev: {
    type: string;
    content?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    ok?: boolean;
    error?: string;
    message?: string;
  }) => void;
}): Promise<{ ran: boolean; id: string; error?: string }> {
  const picked = resolveHarnessOrFallback(opts.harnessFlag, opts.cwd);
  if (picked.fallbackReason || picked.harness.id === 'spockify') {
    return {
      ran: false,
      id: 'spockify',
      error: picked.fallbackReason,
    };
  }
  const result = await runPluginHarness({
    harness: picked.harness,
    cwd: opts.cwd,
    transport: {
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model,
    },
    policy: { mode: 'build', maxTurns: opts.maxTurns ?? 48 },
    messages: opts.messages,
    signal: opts.signal,
    onEvent: (ev) => {
      const type = String(ev.type || ev.t || '');
      opts.onEvent({
        type,
        content: ev.content != null ? String(ev.content) : undefined,
        name: ev.name != null ? String(ev.name) : undefined,
        arguments:
          ev.arguments && typeof ev.arguments === 'object'
            ? (ev.arguments as Record<string, unknown>)
            : undefined,
        ok: ev.ok !== false,
        error: ev.error != null ? String(ev.error) : undefined,
        message: ev.message != null ? String(ev.message) : undefined,
      });
    },
  });
  if (!result.ok) {
    return {
      ran: false,
      id: 'spockify',
      error:
        result.error ||
        `harness ${picked.harness.id} failed; using Spockify kernel`,
    };
  }
  return { ran: true, id: picked.harness.id };
}
