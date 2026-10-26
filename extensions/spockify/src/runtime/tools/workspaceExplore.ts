/**
 * Native workspace explore tools (grep / list_dir / glob) — Remote SSH–safe
 * via vscode.workspace APIs. Prefer these over terminal_run rg/find/ls.
 */

import * as vscode from 'vscode';
import type { ToolCallResult } from '../types';

const DEFAULT_GREP_MAX = 40;
const DEFAULT_GLOB_MAX = 80;
const DEFAULT_LIST_MAX = 200;
const MAX_LINE_CHARS = 240;
const GREP_FILE_SCAN_CAP = 400;

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Normalize to workspace-relative path; reject escapes outside the folder. */
export function normalizeWorkspaceRel(raw: string): string | undefined {
  const root = workspaceRoot();
  if (!root) return undefined;
  let clean = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean || clean === '.') return '';
  if (clean.startsWith('/') || /^[a-zA-Z]:\//.test(clean)) {
    const rootPath = root.fsPath.replace(/\\/g, '/');
    const abs = clean.replace(/\\/g, '/');
    if (abs === rootPath || abs.startsWith(rootPath + '/')) {
      clean = abs.slice(rootPath.length).replace(/^\//, '');
    } else {
      return undefined;
    }
  }
  const parts = clean.split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return undefined;
  return parts.join('/');
}

function relFromUri(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

const DEFAULT_EXCLUDES =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.spockify/**,**/__pycache__/**}';

export async function executeGrep(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const pattern = asString(args.pattern || args.query);
  if (!pattern) {
    return { ok: false, content: '', error: 'grep requires pattern' };
  }
  const root = workspaceRoot();
  if (!root) {
    return { ok: false, content: '', error: 'No workspace folder open' };
  }

  const pathPrefix = normalizeWorkspaceRel(
    asString(args.path || args.pathPrefix || ''),
  );
  if (pathPrefix === undefined) {
    return { ok: false, content: '', error: 'Invalid path' };
  }
  const caseInsensitive =
    args.caseInsensitive === true || args.i === true || args.ignoreCase === true;
  const isRegexp = args.isRegexp !== false && args.fixedString !== true;
  const maxResults = Math.min(
    typeof args.maxResults === 'number' && args.maxResults > 0
      ? Math.floor(args.maxResults)
      : DEFAULT_GREP_MAX,
    100,
  );

  const includeGlob = pathPrefix
    ? pathPrefix.includes('*')
      ? pathPrefix
      : pathPrefix.includes('.') && !pathPrefix.endsWith('/')
        ? pathPrefix
        : `${pathPrefix.replace(/\/$/, '')}/**`
    : '**/*';

  type Hit = {
    path: string;
    line: number;
    preview: string;
  };
  const hits: Hit[] = [];

  let re: RegExp;
  try {
    const body = isRegexp
      ? pattern
      : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(body, caseInsensitive ? 'i' : undefined);
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: `Invalid pattern: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    // findFiles + line scan (workspace.fs) — works for ui-kind / Remote SSH.
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, includeGlob),
      asString(args.exclude) || DEFAULT_EXCLUDES,
      GREP_FILE_SCAN_CAP,
    );
    for (const uri of files) {
      if (hits.length >= maxResults) break;
      let text: string;
      try {
        const raw = await vscode.workspace.fs.readFile(uri);
        text = Buffer.from(raw).toString('utf8');
      } catch {
        continue;
      }
      if (text.length > 1_500_000 || text.includes('\0')) continue;
      const lines = text.split(/\r?\n/);
      const rel = relFromUri(uri);
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= maxResults) break;
        if (!re.test(lines[i])) continue;
        re.lastIndex = 0;
        hits.push({
          path: rel,
          line: i + 1,
          preview: lines[i]
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_LINE_CHARS),
        });
      }
    }
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    content: JSON.stringify({
      pattern,
      hits,
      hitCount: hits.length,
      truncated: hits.length >= maxResults,
      scannedFilesCap: GREP_FILE_SCAN_CAP,
      hint:
        hits.length === 0
          ? 'No matches — try a simpler pattern, pathPrefix, or codebase_search / glob_file_search'
          : undefined,
    }),
  };
}

export async function executeListDir(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const root = workspaceRoot();
  if (!root) {
    return { ok: false, content: '', error: 'No workspace folder open' };
  }
  const rel = normalizeWorkspaceRel(asString(args.path || args.directory || ''));
  if (rel === undefined) {
    return { ok: false, content: '', error: 'Invalid path' };
  }
  const maxEntries = Math.min(
    typeof args.maxEntries === 'number' && args.maxEntries > 0
      ? Math.floor(args.maxEntries)
      : DEFAULT_LIST_MAX,
    500,
  );
  try {
    const uri = rel ? vscode.Uri.joinPath(root, rel) : root;
    const entries = await vscode.workspace.fs.readDirectory(uri);
    entries.sort((a, b) => {
      if (a[1] !== b[1]) {
        return a[1] === vscode.FileType.Directory ? -1 : 1;
      }
      return a[0].localeCompare(b[0]);
    });
    const sliced = entries.slice(0, maxEntries);
    return {
      ok: true,
      content: JSON.stringify({
        path: rel || '.',
        entries: sliced.map(([name, type]) => ({
          name,
          type:
            type & vscode.FileType.Directory
              ? 'dir'
              : type & vscode.FileType.SymbolicLink
                ? 'symlink'
                : 'file',
        })),
        truncated: entries.length > sliced.length,
        total: entries.length,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeGlobFileSearch(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const root = workspaceRoot();
  if (!root) {
    return { ok: false, content: '', error: 'No workspace folder open' };
  }
  const glob = asString(args.glob || args.pattern || args.query);
  if (!glob) {
    return {
      ok: false,
      content: '',
      error: 'glob_file_search requires glob (e.g. **/*.ts)',
    };
  }
  const maxResults = Math.min(
    typeof args.maxResults === 'number' && args.maxResults > 0
      ? Math.floor(args.maxResults)
      : DEFAULT_GLOB_MAX,
    200,
  );
  const pathPrefix = normalizeWorkspaceRel(asString(args.pathPrefix || ''));
  if (pathPrefix === undefined) {
    return { ok: false, content: '', error: 'Invalid pathPrefix' };
  }
  let include = glob.includes('/') || glob.startsWith('**/') ? glob : `**/${glob}`;
  if (pathPrefix) {
    const base = pathPrefix.replace(/\/$/, '');
    include = include.startsWith('**/')
      ? `${base}/${include}`
      : `${base}/**/${include.replace(/^\*\*\//, '')}`;
  }
  try {
    const found = await vscode.workspace.findFiles(
      include,
      asString(args.exclude) || DEFAULT_EXCLUDES,
      maxResults,
    );
    const paths = found.map(relFromUri).sort();
    return {
      ok: true,
      content: JSON.stringify({
        glob: include,
        paths,
        count: paths.length,
        truncated: paths.length >= maxResults,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
