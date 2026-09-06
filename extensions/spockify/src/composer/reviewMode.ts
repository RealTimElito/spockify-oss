/**
 * Composer multi-file Accept staging — panel/tree by default (Cursor-like),
 * optional legacy prompt picker.
 */

import * as vscode from 'vscode';
import type { ComposerReviewMode } from './types';

export function getComposerReviewMode(): ComposerReviewMode {
  const raw = vscode.workspace
    .getConfiguration('spockify')
    .get<string>('composer.reviewMode');
  if (raw === 'tree' || raw === 'prompt' || raw === 'panel') {
    return raw;
  }
  return 'panel';
}

export function verifyAfterTurnEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration('spockify')
      .get<boolean>('composer.verifyAfterTurn') ?? false
  );
}
