/**
 * Extension ↔ webview message protocol for Spockify Chat (Cursor-like).
 */

import type { ChatMessage, ChatSessionSummary, ModelInfo } from './types';
import type { ChatSessionUiState } from './chatSessionUi';
import type { AgentModeUi, ComposerUiMode } from './composerModes';

export type { AgentModeUi, ComposerUiMode } from './composerModes';

/** Persisted chat session id — routes concurrent agent streams to the correct tab. */
export type ChatTabId = string;

export type HostToWebview =
  | {
      type: 'ready';
      models: ModelInfo[];
      selectedModel: string;
      messages: ChatMessage[];
      signedIn: boolean;
      accountLabel?: string;
      sessions?: ChatSessionSummary[];
      currentSessionId?: string;
      openTabIds?: string[];
      streamingTabIds?: ChatTabId[];
      sessionUi?: ChatSessionUiState;
      agentMode?: AgentModeUi;
    }
  | { type: 'streamStart'; chatTabId?: ChatTabId; model?: string }
  | { type: 'streamDelta'; content: string; chatTabId?: ChatTabId }
  | {
      type: 'streamModel';
      model: string;
      attribution: string;
      chatTabId?: ChatTabId;
    }
  | {
      type: 'streamDone';
      chatTabId?: ChatTabId;
      model?: string;
      attribution?: string;
      latencyMs?: number;
      costUsd?: number;
      routingHud?: string;
    }
  | { type: 'streamStopped'; chatTabId?: ChatTabId }
  | { type: 'streamError'; message: string; chatTabId?: ChatTabId }
  | {
      type: 'history';
      messages: ChatMessage[];
      /**
       * Host is mid-turn for this tab — keep accepting streamDelta after the
       * DOM rebuild (do not rely on webview streamingTabIds, which lag).
       */
      resumeStreaming?: boolean;
    }
  | {
      type: 'sessions';
      sessions: ChatSessionSummary[];
      currentSessionId: string;
      openTabIds?: string[];
      streamingTabIds?: ChatTabId[];
      sessionUi?: ChatSessionUiState;
    }
  | { type: 'composerDraft'; text: string }
  | { type: 'historyPanel'; open: boolean }
  | { type: 'models'; models: ModelInfo[]; selectedModel: string }
  | { type: 'auth'; signedIn: boolean; accountLabel?: string }
  | { type: 'latency'; ms: number; chatTabId?: ChatTabId }
  | { type: 'firstToken'; ms: number; chatTabId?: ChatTabId }
  | { type: 'status'; text: string; chatTabId?: ChatTabId }
  | { type: 'agentMode'; mode: AgentModeUi }
  | {
      type: 'modelPrefs';
      auto: boolean;
      maxMode: boolean;
      runAllUnsandboxed?: boolean;
      agentPermissionMode?: string;
      selectedModel: string;
    }
  | {
      type: 'filesChanged';
      count: number;
    }
  | { type: 'sessionPaused'; paused: boolean; chatTabId?: ChatTabId }
  | { type: 'focusInput' }
  | { type: 'newChatTab' }
  | { type: 'switchSessionTab'; id: string }
  | {
      type: 'attachContext';
      chips: {
        file?: boolean;
        terminal?: boolean;
        codebase?: boolean;
        web?: boolean;
      };
      /** Ctrl+L with a non-empty selection — add/replace a removable chip. */
      selectionChip?: {
        id: string;
        fileName: string;
        filePath: string;
        startLine: number;
        endLine: number;
        text: string;
      };
    }
  | {
      type: 'toolStart';
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
      chatTabId?: ChatTabId;
    }
  | {
      type: 'toolResult';
      id: string;
      name: string;
      ok: boolean;
      content: string;
      error?: string;
      checkpointId?: string;
      chatTabId?: ChatTabId;
    }
  | {
      /**
       * Inline accept/reject UI to gate tool execution (e.g. shell commands).
       * Implemented inside the Chat webview composer slot.
       */
      type: 'toolConsentRequest';
      id: string;
      title: string;
      hint?: string;
      badge?: string;
      commandPreview: string;
      allowSessionEnabled?: boolean;
      terminalRunEnabled?: boolean;
      chatTabId?: ChatTabId;
    }
  | {
      /** FIFO queue of sends waiting for the in-flight turn on this tab to
       * finish — lets the composer stay unblocked (Cursor/Claude-Code style
       * "keep typing, hit enter, it queues") instead of dropping input while
       * streaming. Full replacement list (not a delta) — cheap and avoids
       * drift between host/webview state. */
      type: 'queuedSends';
      chatTabId?: ChatTabId;
      items: { id: string; preview: string }[];
    }
  | {
      /** Live parallel-agent status card (Cursor multitask analogue). */
      type: 'agentRunCard';
      runId: string;
      status: string;
      prompt?: string;
      model?: string;
      description?: string;
      workers?: Array<{
        id: string;
        name?: string;
        state?: string;
        prompt?: string;
      }>;
      chatTabId?: ChatTabId;
    }
  | {
      /** Workspace file slice for Cursor-style file cards in the assistant transcript. */
      type: 'fileExcerpt';
      requestId: string;
      path: string;
      startLine: number;
      endLine: number;
      text?: string;
      truncated?: boolean;
      error?: string;
    };

export type WebviewToHost =
  | { type: 'ready' }
  | {
      type: 'send';
      text: string;
      model: string;
      withContext: boolean;
      contextTags?: ('file' | 'codebase' | 'terminal' | 'web')[];
      /** Ctrl+L selection chips to attach as code context. */
      selectionChips?: Array<{
        id: string;
        fileName: string;
        filePath: string;
        startLine: number;
        endLine: number;
        text: string;
      }>;
      /** Paste / paperclip file + image attachments. */
      attachments?: Array<{
        id: string;
        name: string;
        mimeType: string;
        kind: 'image' | 'file';
        dataUrl?: string;
        textContent?: string;
        size: number;
      }>;
      agentMode?: AgentModeUi;
      /** Ctrl/Cmd+Enter while streaming — flip queue ↔ stop-and-send (Cursor). */
      modifierFlip?: boolean;
    }
  | { type: 'selectModel'; model: string }
  | { type: 'selectAgentMode'; mode: AgentModeUi }
  | { type: 'setAutoModel'; enabled: boolean }
  | { type: 'setMaxMode'; enabled: boolean }
  | { type: 'setRunAllUnsandboxed'; enabled: boolean }
  | { type: 'setAgentPermissionMode'; mode: string }
  | { type: 'addModels' }
  | { type: 'composerAcceptAll' }
  | { type: 'composerDiscardAll' }
  | { type: 'composerReview' }
  | { type: 'newChat'; ui?: ChatSessionUiState }
  | { type: 'switchSession'; id: string; ui?: ChatSessionUiState }
  | { type: 'closeSessionTab'; id: string; ui?: ChatSessionUiState }
  | { type: 'requestSessions' }
  | { type: 'openFullSpockify' }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'retry' }
  | { type: 'listSessions' }
  | { type: 'loadSession'; id: string }
  | {
      type: 'applyBlock';
      code: string;
      pathHint?: string;
      /** bash/sh fence — insert into integrated terminal, not file Apply */
      shell?: boolean;
      /** 1-based inclusive line range when applying a snippet into a file */
      startLine?: number;
      endLine?: number;
    }
  | { type: 'undoApply' }
  | { type: 'listCheckpoints' }
  | { type: 'restoreCheckpoint'; id?: string }
  | {
      type: 'openFile';
      path: string;
      line?: number;
      column?: number;
      endLine?: number;
    }
  | {
      type: 'requestFileExcerpt';
      requestId: string;
      path: string;
      startLine: number;
      endLine?: number;
    }
  | { type: 'signIn' }
  | { type: 'openHelp' }
  | { type: 'openSettings' }
  | { type: 'insertAt'; kind: 'file' | 'codebase' | 'terminal' | 'web' }
  | { type: 'spawnAgents'; prompt?: string }
  | { type: 'openAgentRun'; runId: string }
  | {
      /** Cancel one parallel-agent run from the composer Agents HUD (not Stop). */
      type: 'cancelAgentRun';
      runId: string;
    }
  | {
      /** Resolve an inline tool consent request (Enter=Accept, Esc=Reject). */
      type: 'toolConsentResponse';
      id: string;
      decision: 'run' | 'allowSession' | 'terminalRun' | 'reject';
    }
  | {
      /** Remove one queued send (by id) or, if omitted, clear the whole
       * queue for the current tab. Cancelling the in-flight turn (stop)
       * does NOT clear the queue — this is the explicit affordance for
       * that. */
      type: 'clearQueuedSend';
      id?: string;
    };
