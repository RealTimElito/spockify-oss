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
import { MOCK_OSS_MODELS } from './mockTransport';

export function adaptModelTransport(
  transport: ModelTransport,
): ChatModelTransport {
  return {
    async listModels(): Promise<ModelInfo[]> {
      const models = await transport.listModels({ ossOnly: true });
      const mapped = models
        .filter((m) => m?.id)
        .map((m) => ({
          id: m.id,
          label: m.name || m.id,
          oss: true,
        }));
      // Remote OSS filter can return [] (auth lag / renamed ids) — keep picker usable.
      return mapped.length ? mapped : MOCK_OSS_MODELS.slice();
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
        const live = await getLive();
        if (live) return adaptModelTransport(live).listModels();
      } catch {
        /* mock */
      }
      return mock.listModels();
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
              ? `[auth] ${message}\n\n**Sign in again** (status bar → Spockify).\n` +
                `Email/password uses your web account; API key needs a LiteLLM key from https://spockify.eu/ui/\n\n`
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
