/**
 * Mock ChatModelTransport for M0 until packages/spockify-ide-client is ready.
 *
 * TODO(WS-B): Delete usage from registerChatPanel once RemoteSpockifyTransport
 * implements ChatModelTransport (or adapt via thin wrapper).
 */

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatModelTransport,
  ModelInfo,
} from './types';
import { textFromContent } from './chatContent';
import { mergePickerModels } from './modelCatalog';

/** Built-in OSS catalog when remote list is empty / unavailable. */
export const MOCK_OSS_MODELS: ModelInfo[] = mergePickerModels([]);

/** Deterministic fake stream for UI plumbing without network. */
async function* mockStream(
  request: ChatCompletionRequest,
): AsyncIterable<ChatCompletionChunk> {
  const lastUser = [...request.messages]
    .reverse()
    .find((m) => m.role === 'user');
  const preview = textFromContent(lastUser?.content ?? '').trim().slice(0, 80);
  const reply =
    `[mock · ${request.model}] Streaming stub — wire RemoteSpockifyTransport ` +
    `to POST /v1/chat/completions on spockify.eu.\n\n` +
    (preview ? `You said: “${preview}”` : 'Send a message to exercise the stream.');

  const words = reply.split(/(\s+)/);
  for (const part of words) {
    yield {content: part};
    await delay(18);
  }
  yield {content: '', done: true};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockChatTransport implements ChatModelTransport {
  async listModels(): Promise<ModelInfo[]> {
    return MOCK_OSS_MODELS.filter((m) => m.oss !== false);
  }

  chatCompletions(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionChunk> {
    return mockStream(request);
  }
}
