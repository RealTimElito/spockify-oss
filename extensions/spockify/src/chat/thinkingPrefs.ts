/**
 * Read/write IDE thinking preference (vscode config + request extras).
 */

import * as vscode from 'vscode';

import {
  DEFAULT_THINKING_MODE,
  migratePersistedThinking,
  normalizeThinkingMode,
  thinkingRequestFields,
  type ThinkingMode,
} from './thinkingModes';

export function readIdeThinkingMode(): ThinkingMode {
  const cfg = vscode.workspace.getConfiguration('spockify');
  const stored = cfg.get<string>('chat.thinking');
  const maxMode = cfg.get<boolean>('chat.maxMode', false);
  return migratePersistedThinking(stored, undefined, maxMode);
}

export async function writeIdeThinkingMode(mode: ThinkingMode): Promise<void> {
  const resolved = normalizeThinkingMode(mode, DEFAULT_THINKING_MODE);
  await vscode.workspace
    .getConfiguration('spockify')
    .update('chat.thinking', resolved, vscode.ConfigurationTarget.Global);
}

export function thinkingRequestExtras(
  mode?: ThinkingMode,
): Record<string, unknown> {
  const resolved = mode ?? readIdeThinkingMode();
  return thinkingRequestFields(resolved);
}
