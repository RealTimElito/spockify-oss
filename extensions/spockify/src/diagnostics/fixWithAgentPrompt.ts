/**
 * Pure prompt builder for "Fix with agent" (no vscode import — unit-testable).
 */

export type FixDiagSeverity = 'error' | 'warning' | 'info' | 'hint' | 'diagnostic';

export interface FixDiagInput {
  message: string;
  severity: FixDiagSeverity;
  startLine: number; // 0-based
  endLine: number;
  source?: string;
  code?: string | number;
}

export interface FixDocSlice {
  relativePath: string;
  languageId: string;
  /** Full document text (or enough to cover context). */
  text: string;
  lineCount: number;
}

/** Lines of surrounding source to include in the fix prompt. */
export const CONTEXT_RADIUS = 12;

export function buildFixPromptFromParts(
  doc: FixDocSlice,
  diag: FixDiagInput,
): string {
  const startLine = diag.startLine;
  const endLine = diag.endLine;
  const ctxStart = Math.max(0, startLine - CONTEXT_RADIUS);
  const ctxEnd = Math.min(doc.lineCount - 1, endLine + CONTEXT_RADIUS);
  const lines = doc.text.split('\n');
  const snippet = lines.slice(ctxStart, ctxEnd + 1).join('\n');
  const source = diag.source ? ` (${diag.source})` : '';
  const code = diag.code == null ? '' : ` [${String(diag.code)}]`;
  const fence = !doc.languageId || doc.languageId === 'plaintext'
    ? ''
    : doc.languageId;

  return [
    `Fix this ${diag.severity} in \`${doc.relativePath}\` (lines ${startLine + 1}–${endLine + 1})${source}${code}.`,
    '',
    `Diagnostic: ${diag.message}`,
    '',
    'You MUST call tools to apply the fix (do not only explain):',
    '1) Prefer read_file on that path, then apply_patch/write_file with the COMPLETE corrected file contents (keep every line after the fix — never truncate the file at the error).',
    '2) Or apply_patch with a unique snippet of only the changed lines (it will be spliced — do not send a wipe-style truncated file).',
    '3) A markdown unified diff (`--- a/` / `+++ b/`) is a last-resort fallback if tools fail.',
    'Apply a minimal correct fix so I can Accept/Reject (or auto-apply when Allow all is on).',
    'Change only the reported line range ± a few lines (e.g. wrap/reflow a long line for E501). Do not rewrite, delete, or replace code from the error line through end-of-file.',
    '',
    `Nearby code (1-indexed lines ${ctxStart + 1}–${ctxEnd + 1}):`,
    '```' + fence,
    snippet.replace(/\n$/, ''),
    '```',
  ].join('\n');
}

export function severityFromVsCodeNumber(sev: number): FixDiagSeverity {
  switch (sev) {
    case 0:
      return 'error';
    case 1:
      return 'warning';
    case 2:
      return 'info';
    case 3:
      return 'hint';
    default:
      return 'diagnostic';
  }
}
