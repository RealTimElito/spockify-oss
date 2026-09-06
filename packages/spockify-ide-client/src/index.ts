import type { ModelTransport } from './transport';
import type { ProviderId, SpockifyClientOptions } from './types';
import { LocalModelsProviderStub } from './local';
import { RemoteSpockifyProvider } from './remote';

export interface CreateTransportOptions extends SpockifyClientOptions {
  provider?: ProviderId;
  ossOnly?: boolean;
}

/**
 * Resolve the active ModelTransport from settings.
 * Local is reserved; selecting it returns a stub that throws.
 */
export function createModelTransport(
  options: CreateTransportOptions = {},
): ModelTransport {
  const provider = options.provider ?? 'remote';
  if (provider === 'local') {
    return new LocalModelsProviderStub();
  }
  return new RemoteSpockifyProvider(options);
}

export type {
  ModelTransport,
  ChatStreamChunk,
  ChatStreamToolCall,
} from './transport';
export {
  RemoteSpockifyProvider,
  filterModelsOss,
  resolveApiBackend,
} from './remote';
export {
  LocalModelsProviderStub,
  type LocalModelsProvider,
} from './local';
export {
  DEFAULT_BASE_URL,
  SpockifyHttpClient,
  SpockifyHttpError,
  normalizeBaseUrl,
  signInOwui,
  ensureOwuiApiKey,
  looksLikeJwt,
  formatAuthErrorHint,
  type OwuiSignInResult,
} from './http';
export type {
  ApiBackend,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatContent,
  ChatContentPart,
  ChatMessage,
  ChatToolCall,
  GhostContextItem,
  GhostDiffHistoryEntry,
  GhostEdit,
  GhostFate,
  GhostFateRequest,
  GhostLinterError,
  GhostMode,
  GhostSuggestRequest,
  GhostSuggestResponse,
  GhostTrigger,
  HealthStatus,
  ListModelsResponse,
  ModelInfo,
  ProviderId,
  SpockifyClientOptions,
} from './types';
export type {
  AgentRun,
  AgentRunEvent,
  AgentRunStatus,
  AgentWorker,
  AgentWorkerState,
  CreateAgentRunRequest,
  ListAgentRunsResponse,
} from './agents';
