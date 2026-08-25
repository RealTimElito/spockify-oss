/**
 * Phase 1 unified agent runtime.
 * @see docs/SPOCKIFY_IDE_PHASE1_RUNTIME_PLAN.md
 */

export type {
  AgentMode,
  AgentMessage,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeEvent,
  RegisteredTool,
  SessionStatus,
  ToolCallRequest,
  ToolCallResult,
  UnifiedToolDefinition,
} from './types';

export {
  filterToolsForMode,
  isToolAllowed,
  loadAgentModeFromConfig,
  loadStrictAllowlist,
  modeSystemAddon,
} from './modes';

export {
  isRunAllUnsandboxedActive,
  isRunAllUnsandboxedEnabled,
} from './runAllUnsandboxed';

export {
  AGENT_PERMISSION_MODE_META,
  getAgentPermissionMode,
  getAgentPermissionModeMeta,
  isAgentPermissionMode,
  isAllowAllActive,
  isAskModeReadOnly,
  setAgentPermissionMode,
  shouldAutoApproveShell,
  shouldAutoApplyFilePatches,
  shouldForceOsSandboxOff,
  shouldForceShellConfirm,
  shouldReviewFileEdits,
} from './agentPermissionMode';
export type {
  AgentPermissionMode,
  AgentPermissionModeMeta,
} from './agentPermissionMode';

export {
  formatToolsForPrompt,
  mergeToolCalls,
  parseToolCalls,
  stripToolFences,
} from './parseToolCalls';

export {
  DisplayStreamFilter,
  assistantTextForDisplay,
  stripIncompleteToolSuffix,
} from './displayStreamFilter';

export {
  UnifiedToolRegistry,
  getUnifiedToolRegistry,
  resetUnifiedToolRegistry,
} from './unifiedRegistry';

export { AgentRuntime, runAgentTurn, flattenAgentMessagesForApi } from './agentLoop';
export type { AgentRuntimeDeps, ApiChatMessage } from './agentLoop';

export { SessionManager, getSessionManager } from './sessionManager';

export {
  ChatTabAgentHost,
  getChatTabAgentHost,
  resetChatTabAgentHostForTests,
  shouldDeliverStreamToView,
} from './chatTabAgentHost';
export type { ChatTabHostSink, ChatTabTurnInput } from './chatTabAgentHost';

export {
  CHAT_CURRENT_SESSION_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_SESSION_STORE_VERSION,
  ChatSessionStore,
  buildPersistedChatSession,
  createChatSessionId,
  deriveChatTitle,
  listChatSessionSummaries,
  normalizeChatSession,
  sortChatSessionsForHistory,
  stripContextSuffixForTitle,
} from './chatSessionStore';
export type {
  ChatSessionSummary as RuntimeChatSessionSummary,
  MementoLike,
  PersistedChatSession,
  SaveChatSessionInput,
  StoredChatMessage,
} from './chatSessionStore';

export {
  registerAgentRuntime,
  getRuntimeHandle,
} from './register';
export type { RuntimeHandle, TransportFactory } from './register';

export {
  registerBuiltinTools,
  syncMcpToolsIntoUnified,
} from './tools/builtins';
