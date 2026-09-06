import type { ModelTransport } from './transport';
import type {
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  GhostSuggestRequest,
  GhostSuggestResponse,
  HealthStatus,
  ModelInfo,
} from './types';
import type { ChatStreamChunk } from './transport';

/**
 * Future client-local models (Ollama / LM Studio / llama.cpp).
 * Stub only — no discovery or HTTP to localhost in M0/M1.
 */
export interface LocalModelsProvider extends ModelTransport {
  readonly providerId: 'local';
}

export class LocalModelsProviderStub implements LocalModelsProvider {
  readonly providerId = 'local' as const;

  private notImplemented(method: string): never {
    throw new Error(
      `LocalModelsProvider.${method} is not implemented (RemoteSpockify only for now)`,
    );
  }

  health(): Promise<HealthStatus> {
    return this.notImplemented('health');
  }

  listModels(): Promise<ModelInfo[]> {
    return this.notImplemented('listModels');
  }

  chatCompletions(
    _request: ChatCompletionsRequest,
  ): Promise<ChatCompletionsResponse> {
    return this.notImplemented('chatCompletions');
  }

  streamChatCompletions(
    _request: ChatCompletionsRequest,
    _signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    return this.notImplemented('streamChatCompletions');
  }

  ghostSuggest(
    _request: GhostSuggestRequest,
    _signal?: AbortSignal,
  ): Promise<GhostSuggestResponse> {
    return this.notImplemented('ghostSuggest');
  }
}
