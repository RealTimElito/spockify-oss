/**
 * Adapter: ModelTransport → ChatModelTransport with real SSE streaming.
 */

import type { ModelTransport } from '@spockify/ide-client';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatModelTransport,
  ModelInfo,
} from './types';
import { textFromContent } from './chatContent';
import { codingPickerOptionsFromConfig } from './codingPickerConfig';
import { mergePickerModels } from './modelCatalog';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function adaptModelTransport(
  transport: ModelTransport,
): ChatModelTransport {
  return {
    async listModels(): Promise<ModelInfo[]> {
      const cfg = codingPickerOptionsFromConfig();
      // Prefer the unfiltered server list so custom / local models appear.
      let models = await transport.listModels({ ossOnly: false });
      if (!models.length) {
        models = await transport.listModels({ ossOnly: true });
      }
      const mapped = models
        .filter((m) => m?.id)
        .map((m) => ({
          id: m.id,
          label: m.name || m.id,
          oss: true,
        }));
      // Only merge the hard-coded catalog when the server returned nothing.
      if (mapped.length) return mapped;
      return mergePickerModels(mapped, cfg);
    },

    chatCompletions(
      request: ChatCompletionRequest,
    ): AsyncIterable<ChatCompletionChunk> {
      return streamFromTransport(transport, request);
    },
  };
}

async function* streamFromTransport(
  transport: ModelTransport,
  request: ChatCompletionRequest,
): AsyncIterable<ChatCompletionChunk> {
  const signal = request.signal;
  if (typeof transport.streamChatCompletions === 'function') {
    try {
      for await (const chunk of transport.streamChatCompletions(
        {
          model: request.model,
          messages: request.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
          ...(request.spockify_thinking
            ? {
                spockify_thinking: request.spockify_thinking,
                spockify_think_enabled: request.spockify_think_enabled,
              }
            : {}),
        },
        signal,
      )) {
        if (signal?.aborted) {
          yield { content: '', done: true };
          return;
        }
        yield {
          content: chunk.content,
          done: chunk.done,
          model: chunk.model,
        };
        if (chunk.done) return;
      }
      yield { content: '', done: true };
      return;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        yield { content: '', done: true };
        return;
      }
      // Fall through to non-stream
      const message = err instanceof Error ? err.message : String(err);
      yield { content: `[stream fallback] ${message}\n` };
    }
  }

  if (signal?.aborted) {
    yield { content: '', done: true };
    return;
  }

  const res = await transport.chatCompletions({
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: false,
    ...(request.spockify_thinking
      ? {
          spockify_thinking: request.spockify_thinking,
          spockify_think_enabled: request.spockify_think_enabled,
        }
      : {}),
  });
  const text = textFromContent(res.choices?.[0]?.message?.content ?? '');
  if (!text) {
    yield {
      content:
        '(empty reply — sign in / check API key, Output → Spockify)',
    };
    yield { content: '', done: true, model: res.model };
    return;
  }
  // Chunk for UI responsiveness when SSE unavailable
  const size = 24;
  for (let i = 0; i < text.length; i += size) {
    if (signal?.aborted) break;
    yield { content: text.slice(i, i + size), model: res.model };
  }
  yield { content: '', done: true, model: res.model };
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

export function createFallbackChatTransport(
  getLive: () => Promise<ModelTransport | undefined>,
  mock: ChatModelTransport,
): ChatModelTransport {
  return {
    async listModels(): Promise<ModelInfo[]> {
      try {
        const live = await withTimeout(getLive(), 8000, 'getLive');
        if (live) {
          const listed = await withTimeout(
            adaptModelTransport(live).listModels(),
            8000,
            'listModels',
          );
          if (listed.length) return listed;
        }
      } catch (err) {
        console.warn(
          '[spockify] live listModels failed, using fallback catalog:',
          err instanceof Error ? err.message : err,
        );
      }
      const fallback = await mock.listModels();
      return fallback.map((m) => ({
        ...m,
        label: m.label?.includes('(fallback)')
          ? m.label
          : `${m.label || m.id} (fallback)`,
      }));
    },

    chatCompletions(
      request: ChatCompletionRequest,
    ): AsyncIterable<ChatCompletionChunk> {
      return (async function* () {
        try {
          const live = await getLive();
          if (live) {
            yield* adaptModelTransport(live).chatCompletions(request);
            return;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const auth =
            /401|403|unauthorized|Virtual Key expected|sign.?in|Not authenticated/i.test(
              message,
            );
          yield {
            content: auth
              ? `[auth] ${message}\n\n**Sign in again** (status bar → Spockify → Account).\n` +
                `Email/password uses your web account; paste an sk- key from chat Settings → Account → API key (not LiteLLM /ui/).\n\n`
              : `[auth/transport] ${message}\n\nSign in to Spockify (status bar).\n\n`,
          };
          return;
        }
        yield* mock.chatCompletions(request);
      })();
    },
  };
}

export function isChatModelTransport(
  value: unknown,
): value is ChatModelTransport {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.listModels === 'function' &&
    typeof t.chatCompletions === 'function'
  );
}

/** @deprecated */
export function adaptModelTransportNotReady(): never {
  throw new Error('Use adaptModelTransport(ModelTransport)');
}
