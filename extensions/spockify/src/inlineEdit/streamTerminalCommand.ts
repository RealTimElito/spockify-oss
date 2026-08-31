/**
 * Stream a shell command proposal for integrated-terminal Ctrl+K.
 *
 * This path is completion-only: no AgentRuntime tools / no terminal_run.
 * Preview → Accept sends the command via Terminal.sendText.
 */

import type { ModelTransport } from '@spockify/ide-client';
import { normalizeProposedShellCommand } from './normalizeShellCommand';

const TERMINAL_CMD_SYSTEM = [
  'You propose a shell command for the user\'s integrated terminal (Ctrl+K / Quick Question).',
  'This mode has NO tools — do not call terminal_run, do not emit ```tool JSON, and do not write "terminal_run bash …".',
  'Return ONLY the raw shell command line(s) to paste/run — no markdown fences, no explanation, no JSON.',
  'Prefer a single safe command; use && only when necessary.',
  'Do NOT propose rm -rf, mkfs, dd, or curl|bash.',
].join(' ');

export interface StreamTerminalCommandOptions {
  instruction: string;
  terminalName: string;
  selection?: string;
  recentOutput?: string;
  cwdHint?: string;
  model?: string;
  signal?: AbortSignal;
  requestExtras?: Record<string, unknown>;
  onPartial?: (text: string) => void;
}

function cleanPartial(raw: string): string {
  return normalizeProposedShellCommand(raw);
}

export async function streamTerminalCommand(
  transport: ModelTransport,
  opts: StreamTerminalCommandOptions,
): Promise<string | undefined> {
  const model = opts.model || 'spockify-auto';
  const user =
    `Terminal: ${opts.terminalName}\n` +
    (opts.cwdHint ? `Cwd: ${opts.cwdHint}\n` : '') +
    `Instruction: ${opts.instruction}\n\n` +
    (opts.selection
      ? `SELECTED TERMINAL TEXT:\n${opts.selection.slice(0, 4000)}\n\n`
      : '') +
    (opts.recentOutput
      ? `RECENT TERMINAL OUTPUT:\n${opts.recentOutput.slice(0, 8000)}\n`
      : '');

  if (typeof transport.streamChatCompletions === 'function') {
    let raw = '';
    let lastEmitted = '';
    for await (const chunk of transport.streamChatCompletions(
      {
        model,
        messages: [
          { role: 'system', content: TERMINAL_CMD_SYSTEM },
          { role: 'user', content: user },
        ],
        stream: true,
        temperature: 0.1,
        ...(opts.requestExtras || {}),
      },
      opts.signal,
    )) {
      if (opts.signal?.aborted) {
        return undefined;
      }
      if (chunk.content) {
        raw += chunk.content;
        const cleaned = cleanPartial(raw);
        if (cleaned && cleaned !== lastEmitted) {
          lastEmitted = cleaned;
          opts.onPartial?.(cleaned);
        }
      }
      if (chunk.done) {
        break;
      }
    }
    const final = cleanPartial(raw);
    return final || undefined;
  }

  if (typeof transport.chatCompletions === 'function') {
    const res = await transport.chatCompletions({
      model,
      messages: [
        { role: 'system', content: TERMINAL_CMD_SYSTEM },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      ...(opts.requestExtras || {}),
    });
    const text = res.choices?.[0]?.message?.content ?? '';
    const final = cleanPartial(String(text));
    return final || undefined;
  }

  return undefined;
}
