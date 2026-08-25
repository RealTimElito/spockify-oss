/**
 * Linter/diagnostic context for Tab completions (protocol v2 linter_errors).
 * Synchronous read of vscode's in-memory diagnostics — ~0ms.
 */

import * as vscode from 'vscode';
import type { GhostLinterError } from '@spockify/ide-client';

const CHAR_BUDGET = 600;
const MAX_MESSAGE_CHARS = 180;

function severityLabel(sev: vscode.DiagnosticSeverity): string | undefined {
  switch (sev) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    default:
      return undefined;
  }
}

/**
 * Errors/warnings for the current file, nearest to the cursor first
 * (errors win ties), within a ~600 char budget.
 */
export function collectLinterErrors(
  document: vscode.TextDocument,
  cursorLine: number,
): GhostLinterError[] {
  const rel = vscode.workspace.asRelativePath(document.uri, false);
  const rows: Array<{ err: GhostLinterError; distance: number; sev: number }> =
    [];
  for (const diag of vscode.languages.getDiagnostics(document.uri)) {
    const severity = severityLabel(diag.severity);
    if (!severity) {
      continue;
    }
    const line = diag.range.start.line;
    rows.push({
      err: {
        path: rel,
        message: diag.message.slice(0, MAX_MESSAGE_CHARS),
        line,
        severity,
      },
      distance: Math.abs(line - cursorLine),
      sev: diag.severity,
    });
  }
  rows.sort((a, b) => a.distance - b.distance || a.sev - b.sev);

  const out: GhostLinterError[] = [];
  let chars = 0;
  for (const row of rows) {
    const cost = row.err.message.length + row.err.path.length + 16;
    if (chars + cost > CHAR_BUDGET && out.length > 0) {
      break;
    }
    chars += cost;
    out.push(row.err);
  }
  return out;
}
