/** Edit cascade layers 0–4 (exact → ws-norm → anchors → hunk → refuse). */

export type CascadeOk = { ok: true; text: string; layer: number; diff: string };
export type CascadeFail = { ok: false; error: string; layerTried: number };

function lineNorm(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}

function makeDiff(before: string, after: string): string {
  if (before === after) return '(no change)';
  const b = before.split('\n');
  const a = after.split('\n');
  const lines: string[] = [`--- before (${b.length} lines)`, `+++ after (${a.length} lines)`];
  const n = Math.max(b.length, a.length);
  for (let i = 0; i < Math.min(n, 40); i++) {
    if (b[i] !== a[i]) {
      if (b[i] != null) lines.push(`- ${b[i]}`);
      if (a[i] != null) lines.push(`+ ${a[i]}`);
    }
  }
  if (n > 40) lines.push('…');
  return lines.join('\n');
}

/**
 * Layer 0 exact → 1 ws-norm → 2 first/last line anchors → 3 unified hunk
 * → 4 refuse blind overwrite unless allowOverwrite.
 */
export function applyEditCascade(
  text: string,
  search: string,
  replace: string,
  opts?: { allowOverwrite?: boolean; justRead?: boolean },
): CascadeOk | CascadeFail {
  if (!search && opts?.allowOverwrite && opts?.justRead) {
    const next = replace;
    return {
      ok: true,
      text: next,
      layer: 4,
      diff: makeDiff(text, next),
    };
  }
  if (!search) return { ok: false, error: 'search required', layerTried: 0 };

  // L0 exact
  if (text.includes(search)) {
    const count = text.split(search).length - 1;
    if (count > 1) {
      return { ok: false, error: 'SEARCH matches multiple times', layerTried: 0 };
    }
    const next = text.replace(search, replace);
    return { ok: true, text: next, layer: 0, diff: makeDiff(text, next) };
  }

  // L1 whitespace-normalized
  const nt = lineNorm(text);
  const ns = lineNorm(search);
  const nr = lineNorm(replace);
  if (ns && nt.includes(ns)) {
    const count = nt.split(ns).length - 1;
    if (count > 1) {
      return {
        ok: false,
        error: 'SEARCH matches multiple times (ws-norm)',
        layerTried: 1,
      };
    }
    const next = nt.replace(ns, nr);
    return { ok: true, text: next, layer: 1, diff: makeDiff(text, next) };
  }

  // L2 first-line + last-line anchors
  const sLines = search.replace(/\r\n/g, '\n').split('\n');
  if (sLines.length >= 2) {
    const first = sLines[0]!;
    const last = sLines[sLines.length - 1]!;
    const tLines = text.replace(/\r\n/g, '\n').split('\n');
    let start = -1;
    let end = -1;
    for (let i = 0; i < tLines.length; i++) {
      if (lineNorm(tLines[i]!) === lineNorm(first)) {
        start = i;
        break;
      }
    }
    if (start >= 0) {
      for (let j = tLines.length - 1; j >= start; j--) {
        if (lineNorm(tLines[j]!) === lineNorm(last)) {
          end = j;
          break;
        }
      }
    }
    if (start >= 0 && end >= start) {
      const next = [
        ...tLines.slice(0, start),
        ...replace.replace(/\r\n/g, '\n').split('\n'),
        ...tLines.slice(end + 1),
      ].join('\n');
      return { ok: true, text: next, layer: 2, diff: makeDiff(text, next) };
    }
  }

  // L3 minimal unified hunk: @@ -N,M +N,M @@ style body without headers
  const hunk = search.match(/^@@[^\n]*\n([\s\S]*)$/m);
  if (hunk) {
    const body = hunk[1] || '';
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (const line of body.split('\n')) {
      if (line.startsWith('-')) oldLines.push(line.slice(1));
      else if (line.startsWith('+')) newLines.push(line.slice(1));
      else if (line.startsWith(' ')) {
        oldLines.push(line.slice(1));
        newLines.push(line.slice(1));
      }
    }
    const oldBlock = oldLines.join('\n');
    if (oldBlock && text.includes(oldBlock)) {
      const next = text.replace(oldBlock, newLines.join('\n'));
      return { ok: true, text: next, layer: 3, diff: makeDiff(text, next) };
    }
  }

  // L4 refuse blind overwrite
  if (opts?.allowOverwrite && opts?.justRead) {
    const next = replace;
    return {
      ok: true,
      text: next,
      layer: 4,
      diff: makeDiff(text, next),
    };
  }
  const failingHunk = search.slice(0, 2000);
  return {
    ok: false,
    error:
      'SEARCH not found (exact+ws-norm+anchors); refuse blind overwrite without just-read\n' +
      '--- failing hunk ---\n' +
      failingHunk,
    layerTried: 4,
  };
}

/** Back-compat wrapper used by gitTxn / tools. */
export function applySearchReplace(
  text: string,
  search: string,
  replace: string,
): { ok: true; text: string; layer: number } | { ok: false; error: string } {
  const r = applyEditCascade(text, search, replace);
  if (r.ok) return { ok: true, text: r.text, layer: r.layer };
  return { ok: false, error: r.error };
}
