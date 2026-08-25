/**
 * Context builders — @file / @selection / rules / memories / codebase hits.
 */

import * as vscode from 'vscode';
import { getEffectiveRules, loadProjectRules } from './load';
import { formatMemoriesForPrompt } from './memories';
import { parseMentions } from './mentions';
import { formatWebHits, searchWeb } from './webContext';
import {
  editorAttachFlagsFromSnapshot,
  selectionDisplayRange,
  type EditorContextSnapshot,
  type SelectionContextChip,
} from './editorAttach';

export {
  editorAttachFlagsFromSnapshot,
  selectionChipFromSnapshot,
  selectionDisplayRange,
  type EditorContextSnapshot,
  type SelectionContextChip,
} from './editorAttach';

export { loadProjectRules, getEffectiveRules };
export { parseMentions } from './mentions';

export async function resolveWebSection(
  extContext: vscode.ExtensionContext | undefined,
  instruction: string,
  opts?: { force?: boolean },
): Promise<string | undefined> {
  if (!extContext) return undefined;
  const mentions = parseMentions(instruction);
  const want =
    opts?.force ||
    mentions.kinds.has('web') ||
    mentions.kinds.has('docs');
  if (!want) {
    return undefined;
  }
  const query = mentions.cleanQuery || instruction;
  try {
    const hits = await searchWeb(extContext, query, 5);
    return formatWebHits(hits);
  } catch {
    return undefined;
  }
}

const DEFAULT_HIT_CHARS = 1800;
const DEFAULT_FILE_CHARS = 10000;
const DEFAULT_SEL_CHARS = 6000;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Workspace-relative path for prompts (falls back to basename). */
export function workspaceRelPath(absOrRel: string): string {
  const raw = (absOrRel || '').trim();
  if (!raw) return 'file';
  try {
    const rel = vscode.workspace.asRelativePath(raw, false);
    if (rel && rel !== raw) return rel.replace(/\\/g, '/');
    // Already relative or outside workspace
    if (!raw.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(raw)) {
      return raw.replace(/\\/g, '/');
    }
  } catch {
    /* ignore */
  }
  const parts = raw.split(/[/\\]/);
  return parts[parts.length - 1] || raw;
}

export function captureEditorContext(): EditorContextSnapshot | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const sel = editor.selection;
  const selectionText = editor.document.getText(sel);
  const range = selectionDisplayRange(
    sel.start.line,
    sel.start.character,
    sel.end.line,
    sel.end.character,
  );
  return {
    fileName: editor.document.fileName,
    filePath: editor.document.uri.fsPath,
    selectionText,
    fileText: editor.document.getText(),
    hasNonemptySelection: Boolean(selectionText.trim()),
    startLine: range.startLine,
    endLine: range.endLine,
  };
}

/** Cursor Ctrl+L: selection if non-empty, else active file. */
export function resolveEditorAttachFlags(): {
  includeSelection: boolean;
  includeActiveFile: boolean;
} {
  return editorAttachFlagsFromSnapshot(captureEditorContext());
}

export async function buildAtContext(opts?: {
  includeSelection?: boolean;
  includeActiveFile?: boolean;
  /** Explicit Ctrl+L selection chips (multi); preferred over includeSelection. */
  selectionChips?: SelectionContextChip[];
  extraUris?: vscode.Uri[];
  context?: vscode.ExtensionContext;
  codebaseHits?: Array<{ path: string; startLine: number; endLine: number; text: string }>;
  /** Pre-fetched web search block (from @web / @docs). */
  webSection?: string;
  /** Integrated terminal block (@terminal). */
  terminalSection?: string;
  /** Snapshot from Ctrl+L; preferred over live editor at Send time. */
  editorSnapshot?: EditorContextSnapshot;
  /** Soft cap (tokens); trims later sections first. */
  budgetTokens?: number;
}): Promise<string> {
  const parts: string[] = [];
  const selectionChips = (opts?.selectionChips ?? []).filter((c) =>
    Boolean(c?.text?.trim()),
  );
  const includeSelection =
    selectionChips.length === 0 && opts?.includeSelection !== false;
  const includeActiveFile = opts?.includeActiveFile !== false;
  const budget =
    opts?.budgetTokens ??
    vscode.workspace
      .getConfiguration('spockify.codebase')
      .get<number>('contextBudgetTokens', 4000);

  if (opts?.context) {
    const effective = await getEffectiveRules(opts.context);
    if (effective.text) {
      parts.push(effective.text);
    }
    const mem = await formatMemoriesForPrompt(opts.context);
    if (mem) {
      parts.push(`## Memories\n${mem}`);
    }
  } else {
    const rules = await loadProjectRules();
    if (rules) {
      parts.push(`Project rules (.spockify/rules):\n${rules}`);
    }
  }

  if (opts?.codebaseHits?.length) {
    const seen = new Set<string>();
    const blocks: string[] = [];
    for (const h of opts.codebaseHits) {
      const key = `${h.path}:${h.startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(
        `@codebase ${h.path}:${h.startLine}-${h.endLine}\n\`\`\`\n${h.text.slice(0, DEFAULT_HIT_CHARS)}\n\`\`\``,
      );
    }
    if (blocks.length) {
      parts.push(blocks.join('\n\n'));
    }
  }

  if (opts?.webSection?.trim()) {
    parts.push(opts.webSection.trim());
  }

  if (opts?.terminalSection?.trim()) {
    parts.push(opts.terminalSection.trim());
  }

  if (selectionChips.length) {
    for (const chip of selectionChips) {
      const pathLabel = workspaceRelPath(chip.filePath || chip.fileName);
      const label = `${pathLabel} ${chip.startLine}-${chip.endLine}`;
      parts.push(
        `@selection (${label}):\n\`\`\`\n${chip.text.slice(0, DEFAULT_SEL_CHARS)}\n\`\`\``,
      );
    }
  }

  const snap = opts?.editorSnapshot;
  const editor = vscode.window.activeTextEditor;
  const activePath = snap?.filePath ?? editor?.document.uri.fsPath;

  if (snap?.filePath) {
    if (includeSelection && snap.hasNonemptySelection) {
      const pathLabel = workspaceRelPath(snap.filePath || snap.fileName);
      const range =
        snap.startLine != null && snap.endLine != null
          ? ` ${snap.startLine}-${snap.endLine}`
          : '';
      parts.push(
        `@selection (${pathLabel}${range}):\n\`\`\`\n${snap.selectionText.slice(0, DEFAULT_SEL_CHARS)}\n\`\`\``,
      );
    }
    if (includeActiveFile) {
      const pathLabel = workspaceRelPath(snap.filePath || snap.fileName);
      const body = snap.fileText.slice(0, DEFAULT_FILE_CHARS);
      parts.push(`@file ${pathLabel}:\n\`\`\`\n${body}\n\`\`\``);
    }
  } else if (editor) {
    if (includeSelection) {
      const selRange = editor.selection;
      const sel = editor.document.getText(selRange);
      if (sel.trim()) {
        const pathLabel = workspaceRelPath(editor.document.uri.fsPath);
        const range = selectionDisplayRange(
          selRange.start.line,
          selRange.start.character,
          selRange.end.line,
          selRange.end.character,
        );
        parts.push(
          `@selection (${pathLabel} ${range.startLine}-${range.endLine}):\n\`\`\`\n${sel.slice(0, DEFAULT_SEL_CHARS)}\n\`\`\``,
        );
      }
    }
    if (includeActiveFile) {
      const pathLabel = workspaceRelPath(editor.document.uri.fsPath);
      const body = editor.document.getText().slice(0, DEFAULT_FILE_CHARS);
      parts.push(`@file ${pathLabel}:\n\`\`\`\n${body}\n\`\`\``);
    }
  }

  const skipExtra = new Set<string>();
  if (activePath) skipExtra.add(activePath);

  for (const uri of opts?.extraUris || []) {
    if (skipExtra.has(uri.fsPath)) continue;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(data).toString('utf8').slice(0, 8000);
      const name = vscode.workspace.asRelativePath(uri, false);
      parts.push(`@file ${name}:\n\`\`\`\n${text}\n\`\`\``);
    } catch {
      /* skip missing paths */
    }
  }

  // Pack under budget: keep earlier (rules/memories/codebase) when possible
  let packed = '';
  for (const part of parts) {
    const next = packed ? `${packed}\n\n${part}` : part;
    if (approxTokens(next) > budget && packed) {
      const remain = Math.max(200, (budget - approxTokens(packed)) * 4);
      if (remain > 400) {
        packed = `${packed}\n\n${part.slice(0, remain)}\n…[truncated to budget]`;
      }
      break;
    }
    packed = next;
  }
  return packed;
}
