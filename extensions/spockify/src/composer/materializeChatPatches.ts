/**
 * Turn parsed chat fences into full-file FilePatch proposals for review.
 */

import * as vscode from 'vscode';
import { resolveWorkspaceUri } from '../chat/openWorkspaceFile';
import {
  applyUnifiedDiffBody,
  parseAssistantUnifiedDiffFiles,
} from './assistantProseDiffs';
import {
  parseChatFencePatches,
  spliceLineRange,
  type ParsedFencePatch,
} from './parsePatches';
import {
  isDestructiveFullReplace,
  looksLikeSnippetVsFile,
  resolveNonDestructiveNext,
} from './patchSanity';
import type { FilePatch } from './types';

export {
  trySnippetReplace,
  isDestructiveFullReplace,
  isMidFileSuffixWipe,
  resolveNonDestructiveNext,
  recoverSurgicalEdit,
} from './patchSanity';

export type CollectChatReviewResult = {
  patches: FilePatch[];
  /** Human-readable skip/refuse reasons (never silent for Fix with agent). */
  skips: string[];
};

async function readUriText(uri: vscode.Uri): Promise<string> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  } catch {
    return '';
  }
}

function workspaceRel(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

/**
 * Materialize fence/snippet patches into full-file replacements.
 * Line-ranged snippets are spliced into the on-disk file.
 * Skips no-op patches and refuses destructive "snippet as whole file" replaces
 * unless unique-snippet locate can splice them safely.
 */
export async function materializeChatPatches(
  parsed: ParsedFencePatch[],
): Promise<FilePatch[]> {
  const { patches } = await materializeChatPatchesWithSkips(parsed);
  return patches;
}

export async function materializeChatPatchesWithSkips(
  parsed: ParsedFencePatch[],
): Promise<CollectChatReviewResult> {
  const out: FilePatch[] = [];
  const skips: string[] = [];
  for (const p of parsed) {
    if (!p.path || !p.content.trim()) continue;
    if (p.startLine != null && p.endLine != null) {
      const uri = await resolveWorkspaceUri(p.path);
      if (!uri) {
        out.push({ path: p.path, content: p.content });
        continue;
      }
      const current = await readUriText(uri);
      const next = spliceLineRange(current, p.startLine, p.endLine, p.content);
      if (next === current) continue;
      const resolved = resolveNonDestructiveNext(current, next);
      if (!resolved) {
        skips.push(
          `${p.path}: refused line-range splice (would wipe most of the file)`,
        );
        continue;
      }
      out.push({
        path: workspaceRel(uri) || p.path,
        content: resolved.next,
      });
      continue;
    }

    const uri = await resolveWorkspaceUri(p.path);
    if (uri) {
      const current = await readUriText(uri);
      const resolved = resolveNonDestructiveNext(current, p.content);
      if (resolved) {
        if (resolved.next === current) continue;
        out.push({
          path: workspaceRel(uri) || p.path,
          content: resolved.next,
        });
        continue;
      }
      if (p.content === current) continue;
      if (
        looksLikeSnippetVsFile(current, p.content) ||
        isDestructiveFullReplace(current, p.content)
      ) {
        skips.push(
          `${p.path}: refused fence body as full file (snippet/wipe); ` +
            'could not locate a unique splice target',
        );
        continue;
      }
      out.push({ path: workspaceRel(uri) || p.path, content: p.content });
      continue;
    }
    out.push({ path: p.path, content: p.content });
  }
  return { patches: out, skips };
}

/**
 * Materialize unified-diff ApplyPatchFile entries into full-file FilePatches.
 * Drops applies that would wipe most of the file (bad hunk / reverse / truncated).
 */
export async function materializeUnifiedDiffPatches(
  assistantText: string,
): Promise<FilePatch[]> {
  const { patches } = await materializeUnifiedDiffPatchesWithSkips(assistantText);
  return patches;
}

export async function materializeUnifiedDiffPatchesWithSkips(
  assistantText: string,
): Promise<CollectChatReviewResult> {
  const files = parseAssistantUnifiedDiffFiles(assistantText);
  const out: FilePatch[] = [];
  const skips: string[] = [];
  for (const f of files) {
    const diff = f.unifiedDiff?.trim();
    if (!diff || !f.path) continue;
    const uri = await resolveWorkspaceUri(f.path);
    const current = uri ? await readUriText(uri) : '';
    const next = applyUnifiedDiffBody(f.path, current, diff);
    if (next === current) {
      skips.push(`${f.path}: unified diff did not change the file`);
      continue;
    }
    if (current && isDestructiveFullReplace(current, next)) {
      skips.push(`${f.path}: refused unified diff result (destructive wipe)`);
      continue;
    }
    out.push({
      path: uri ? workspaceRel(uri) || f.path : f.path,
      content: next,
    });
  }
  return { patches: out, skips };
}

/**
 * Collect reviewable patches from assistant text (+ open editor fallback).
 * Prefer unified diffs (`--- a/` / `diff --git`) over path fences for the same
 * path — fences often contain wrap snippets that used to full-replace the file.
 */
export async function collectChatReviewPatches(
  assistantText: string,
  options?: { allowOpenEditorFallback?: boolean },
): Promise<FilePatch[]> {
  const { patches } = await collectChatReviewPatchesDetailed(
    assistantText,
    options,
  );
  return patches;
}

export async function collectChatReviewPatchesDetailed(
  assistantText: string,
  options?: { allowOpenEditorFallback?: boolean },
): Promise<CollectChatReviewResult> {
  const fromDiff = await materializeUnifiedDiffPatchesWithSkips(assistantText);
  const parsed = parseChatFencePatches(assistantText);
  const fromFences = await materializeChatPatchesWithSkips(parsed);
  const skips = [...fromDiff.skips, ...fromFences.skips];

  const patches: FilePatch[] = [...fromDiff.patches];
  const have = new Set(patches.map((p) => p.path));
  for (const p of fromFences.patches) {
    if (have.has(p.path)) continue;
    patches.push(p);
    have.add(p.path);
  }

  if (!patches.length && options?.allowOpenEditorFallback !== false) {
    const inferred = await inferPatchFromOpenEditor(assistantText);
    if (inferred.patch) patches.push(inferred.patch);
    if (inferred.skip) skips.push(inferred.skip);
  }

  return { patches, skips };
}

/**
 * When the model dumps a single language fence (no path) for the open file /
 * selection, stage that as a patch.
 */
async function inferPatchFromOpenEditor(
  text: string,
): Promise<{ patch?: FilePatch; skip?: string }> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return {};
  const doc = editor.document;
  if (doc.uri.scheme === 'output' || doc.uri.scheme === 'debug') return {};

  const fences = [...text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
  const codeFences = fences.filter((m) => {
    const info = (m[1] || '').trim();
    if (/^(tool|tool_call|bash|sh|shell|zsh|diff)\b/i.test(info)) return false;
    const body = (m[2] || '').trim();
    return body.length > 0;
  });
  if (codeFences.length !== 1) return {};

  const body = codeFences[0][2].replace(/\n$/, '');
  const rel = workspaceRel(doc.uri);
  const path =
    rel && !rel.startsWith('..')
      ? rel
      : doc.fileName.split(/[/\\]/).pop() || 'untitled';

  if (!editor.selection.isEmpty) {
    const full = doc.getText();
    const start = doc.offsetAt(editor.selection.start);
    const end = doc.offsetAt(editor.selection.end);
    const next = full.slice(0, start) + body + full.slice(end);
    const resolved = resolveNonDestructiveNext(full, next);
    if (!resolved) {
      return {
        skip: `${path}: open-editor selection replace refused (destructive)`,
      };
    }
    return { patch: { path, content: resolved.next } };
  }

  const current = doc.getText();
  const resolved = resolveNonDestructiveNext(current, body);
  if (resolved) {
    return { patch: { path, content: resolved.next } };
  }

  // Full-file-ish: body covers most of the file
  const curLines = current.split('\n').length;
  const bodyLines = body.split('\n').length;
  if (curLines > 0 && bodyLines >= Math.max(8, Math.floor(curLines * 0.5))) {
    if (isDestructiveFullReplace(current, body)) {
      return { skip: `${path}: open-editor fence refused (destructive)` };
    }
    return { patch: { path, content: body } };
  }
  return {
    skip: `${path}: open-editor fence looked like a snippet and could not be spliced`,
  };
}
