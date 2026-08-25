import * as vscode from 'vscode';
import { getSessionManager } from './sessionManager';
import { getChatTabAgentHost } from './chatTabAgentHost';

export type ToolConsentDecision = 'run' | 'allowSession' | 'terminalRun' | 'reject';

export interface ToolConsentRequestUi {
  title: string;
  hint?: string;
  commandPreview: string;
  /** Optional policy badge appended under the title. */
  badge?: string;
  allowSessionEnabled?: boolean;
  terminalRunEnabled?: boolean;
}

interface PendingConsent {
  resolve: (d: ToolConsentDecision) => void;
}

const pending = new Map<string, PendingConsent>();

function makeId(): string {
  return `consent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Prefer Cursor-like inline chat consent whenever a chat webview is available.
 * Falls back to a modal only when no chat surface can host the card.
 */
function resolveChatTabId(runtimeSessionId: string): string | undefined {
  const manager = getSessionManager();
  const managed = manager.get(runtimeSessionId);
  if (managed?.surface === 'chat' && managed.chatTabId) {
    return managed.chatTabId;
  }
  // Agent/composer sessions still surface consent in the active chat panel.
  const viewTab = getChatTabAgentHost().getViewTabId()?.trim();
  if (viewTab) return viewTab;
  if (managed?.chatTabId) return managed.chatTabId;
  return undefined;
}

export async function requestToolConsent(
  runtimeSessionId: string,
  ui: ToolConsentRequestUi,
  signal?: AbortSignal,
): Promise<ToolConsentDecision> {
  const chatTabId = resolveChatTabId(runtimeSessionId);

  if (chatTabId) {
    const id = makeId();
    const decision = await new Promise<ToolConsentDecision>((resolve) => {
      pending.set(id, { resolve });
      const onAbort = (): void => {
        pending.delete(id);
        resolve('reject');
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      getChatTabAgentHost().requestToolConsent(chatTabId, {
        type: 'toolConsentRequest',
        id,
        title: ui.title,
        hint: ui.hint,
        badge: ui.badge,
        commandPreview: ui.commandPreview,
        allowSessionEnabled: ui.allowSessionEnabled ?? false,
        terminalRunEnabled: ui.terminalRunEnabled ?? true,
      });
    });
    return decision;
  }

  // Fallback: hard blocking modal when no chat panel is mounted.
  const options: string[] = [];
  if (ui.allowSessionEnabled) options.push('Allow for session');
  if (ui.terminalRunEnabled) options.push('Run in Terminal');
  options.unshift('Run');
  options.push('Reject');

  const message = [
    ui.title + (ui.hint ? `\n(${ui.hint})` : ''),
    ui.commandPreview,
    ui.badge ? `\n\n[${ui.badge}]` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const picked = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    ...options,
  );

  switch (picked) {
    case 'Run':
      return 'run';
    case 'Allow for session':
      return 'allowSession';
    case 'Run in Terminal':
      return 'terminalRun';
    case 'Reject':
    default:
      return 'reject';
  }
}

export function resolveToolConsent(
  id: string,
  decision: ToolConsentDecision,
): void {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.resolve(decision);
}

/** Reject every outstanding consent (Stop / cancel ladder). */
export function rejectAllPendingToolConsents(): void {
  for (const [id, p] of [...pending.entries()]) {
    pending.delete(id);
    p.resolve('reject');
  }
}
