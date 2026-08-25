/**
 * Stream Ctrl+K edit proposals via chat SSE (Ghost edit is non-streaming).
 * Falls back to ghostSuggest when stream is unavailable.
 */

import type { ModelTransport } from '@spockify/ide-client';

const EDIT_SYSTEM =
  'You rewrite the selected code per the user instruction. ' +
  'Return ONLY the replacement code — no markdown fences, no preamble, no explanation.';

/** Strip surrounding markdown fences; tolerate incomplete closing fence mid-stream. */
export function stripEditFences(text: string): string {
  let t = text.replace(/^\uFEFF/, '').trimStart();
  if (!t.startsWith('```')) {
    return text.trimEnd();
  }
  const firstNl = t.indexOf('\n');
  if (firstNl === -1) {
    return '';
  }
  t = t.slice(firstNl + 1);
  const close = t.lastIndexOf('\n```');
  if (close !== -1) {
    t = t.slice(0, close);
  } else if (t.endsWith('```')) {
    t = t.slice(0, -3);
  }
  return t.replace(/\s+$/, '');
}

export interface StreamEditOptions {
  language: string;
  filename: string;
  selection: string;
  instruction: string;
  prefix?: string;
  suffix?: string;
  model?: string;
  signal?: AbortSignal;
  /** Called with cleaned partial replacement (RAF-coalesce upstream). */
  onPartial?: (text: string) => void;
}

export interface StreamEditResult {
  text: string;
  model: string;
}

/**
 * Prefer streaming chat completions for live preview; fallback to Ghost edit.
 */
export async function streamOrFetchEdit(
  transport: ModelTransport,
  opts: StreamEditOptions,
): Promise<StreamEditResult | undefined> {
  const model =
    opts.model ||
    // defaultModel is resolved by caller when possible
    'spockify-auto';

  if (typeof transport.streamChatCompletions === 'function') {
    try {
      const user =
        `Language: ${opts.language}\nFilename: ${opts.filename}\n` +
        `Instruction: ${opts.instruction}\n\n` +
        (opts.prefix ? `PREFIX:\n${opts.prefix.slice(-1500)}\n\n` : '') +
        `SELECTION:\n${opts.selection.slice(0, 6000)}\n` +
        (opts.suffix ? `\nSUFFIX:\n${opts.suffix.slice(0, 1500)}\n` : '');

      let raw = '';
      let lastEmitted = '';
      let usedModel = model;
      for await (const chunk of transport.streamChatCompletions(
        {
          model,
          messages: [
            { role: 'system', content: EDIT_SYSTEM },
            { role: 'user', content: user },
          ],
          stream: true,
          temperature: 0.2,
        },
        opts.signal,
      )) {
        if (opts.signal?.aborted) {
          break;
        }
        if (chunk.model) usedModel = chunk.model;
        if (chunk.content) {
          raw += chunk.content;
          const cleaned = stripEditFences(raw);
          if (cleaned && cleaned !== lastEmitted) {
            lastEmitted = cleaned;
            opts.onPartial?.(cleaned);
          }
        }
        if (chunk.done) {
          break;
        }
      }
      const final = stripEditFences(raw);
      if (final.trim()) {
        return { text: final, model: usedModel };
      }
    } catch (err) {
      if (opts.signal?.aborted) {
        return undefined;
      }
      // fall through to ghostSuggest
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        return undefined;
      }
    }
  }

  if (opts.signal?.aborted) {
    return undefined;
  }

  const res = await transport.ghostSuggest(
    {
      mode: 'edit',
      language: opts.language,
      filename: opts.filename,
      selection: opts.selection,
      instruction: opts.instruction,
      code: '',
      prefix: opts.prefix || '',
      suffix: opts.suffix || '',
    },
    opts.signal,
  );
  const text = (res.suggestion || res.insert_text || '').trim();
  if (text) {
    opts.onPartial?.(text);
  }
  return text ? { text, model } : undefined;
}
