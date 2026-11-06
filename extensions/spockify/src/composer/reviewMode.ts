/**
 * Composer multi-file Accept staging — panel/tree by default (Cursor-like),
 * optional legacy prompt picker.
 */

import * as fs from 'fs';
import * as path from 'path';
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

/** Detect common test/typecheck entrypoints in the workspace root. */
export function workspaceHasDetectableVerifyCommand(): boolean {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return false;
  try {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts || {};
      if (scripts.test || scripts.lint || scripts.typecheck || scripts.check) {
        return true;
      }
    }
    for (const name of [
      'pytest.ini',
      'pyproject.toml',
      'Cargo.toml',
      'Makefile',
      'go.mod',
    ]) {
      if (fs.existsSync(path.join(root, name))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Post-turn verify QuickPick.
 * Default true (SWE-style). Explicit user setting always wins; when unset,
 * also enable if a test/lint command looks detectable.
 */
export function verifyAfterTurnEnabled(): boolean {
  const cfg = vscode.workspace.getConfiguration('spockify');
  const inspected = cfg.inspect<boolean>('composer.verifyAfterTurn');
  if (inspected?.globalValue !== undefined) {
    return inspected.globalValue;
  }
  if (inspected?.workspaceValue !== undefined) {
    return inspected.workspaceValue;
  }
  if (inspected?.workspaceFolderValue !== undefined) {
    return inspected.workspaceFolderValue;
  }
  // package.json default is true; fall back to detectable verify when needed
  const configured = cfg.get<boolean>('composer.verifyAfterTurn');
  if (configured === true) return true;
  if (configured === false) return false;
  return workspaceHasDetectableVerifyCommand();
}
