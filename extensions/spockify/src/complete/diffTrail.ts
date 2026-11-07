/**
 * Pure diff-trail core for the Tab diff-history collector (protocol v2).
 * No vscode imports — see diffHistory.ts for the workspace wiring.
 */

export interface TrailDiff {
  diff: string;
  ts: number;
}

export interface FileTrail {
  file: string;
  diffs: TrailDiff[];
  /** Last time this file was edited (ms). */
  touchedAt: number;
}

export interface DiffHistorySnapshotEntry {
  file: string;
  diffs: string[];
  timestamps: number[];
}

/** Per-file cap on retained diffs. */
export const TRAIL_MAX_DIFFS_PER_FILE = 10;
/** Only the N most recently edited files are retained. */
export const TRAIL_MAX_FILES = 5;
/** Hard char budget for what a snapshot sends (sum of diff text). */
export const TRAIL_SNAPSHOT_CHAR_BUDGET = 2000;
/** Max diffs across all files in one snapshot. */
export const TRAIL_SNAPSHOT_MAX_DIFFS = 10;
/** Cap a single unified diff — a giant paste is not a useful edit trail. */
export const TRAIL_MAX_DIFF_CHARS = 700;

/**
 * Minimal unified diff between two texts: common prefix/suffix lines are
 * trimmed and the changed middle becomes one hunk. Cheap (O(n) line scan) —
 * intentionally not Myers; edit-trail diffs are tiny and burst-coalesced.
 */
export function computeUnifiedDiff(
  before: string,
  after: string,
  file: string,
): string {
  if (before === after) {
    return '';
  }
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  const maxStart = Math.min(a.length, b.length);
  while (start < maxStart && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const removed = a.slice(start, endA);
  const added = b.slice(start, endB);
  if (removed.length === 0 && added.length === 0) {
    return '';
  }
  const oldStart = removed.length ? start + 1 : start;
  const newStart = added.length ? start + 1 : start;
  const lines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${oldStart},${removed.length} +${newStart},${added.length} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ];
  let out = lines.join('\n');
  if (out.length > TRAIL_MAX_DIFF_CHARS) {
    out = `${out.slice(0, TRAIL_MAX_DIFF_CHARS)}\n…(truncated)`;
  }
  return out;
}

/** Append a flushed diff to a file's trail, enforcing per-file/global caps. */
export function pushTrailDiff(
  trails: Map<string, FileTrail>,
  file: string,
  diff: string,
  ts: number,
): void {
  if (!diff) {
    return;
  }
  let trail = trails.get(file);
  if (!trail) {
    trail = { file, diffs: [], touchedAt: ts };
    trails.set(file, trail);
  }
  trail.touchedAt = ts;
  trail.diffs.push({ diff, ts });
  if (trail.diffs.length > TRAIL_MAX_DIFFS_PER_FILE) {
    trail.diffs.splice(0, trail.diffs.length - TRAIL_MAX_DIFFS_PER_FILE);
  }
  if (trails.size > TRAIL_MAX_FILES) {
    const byAge = [...trails.values()].sort(
      (x, y) => x.touchedAt - y.touchedAt,
    );
    for (const stale of byAge.slice(0, trails.size - TRAIL_MAX_FILES)) {
      trails.delete(stale.file);
    }
  }
}

/**
 * Snapshot trails for one request: newest diffs win, entries ordered
 * oldest-file → newest-file (newest last, per protocol v2), within the
 * global char budget and diff count.
 */
export function snapshotTrails(
  trails: Map<string, FileTrail>,
  opts?: { charBudget?: number; maxDiffs?: number },
): DiffHistorySnapshotEntry[] {
  const budget = opts?.charBudget ?? TRAIL_SNAPSHOT_CHAR_BUDGET;
  const maxDiffs = opts?.maxDiffs ?? TRAIL_SNAPSHOT_MAX_DIFFS;

  // Flatten to (file, diff, ts), newest first, then take under budget.
  const flat: Array<{ file: string; diff: TrailDiff }> = [];
  for (const trail of trails.values()) {
    for (const d of trail.diffs) {
      flat.push({ file: trail.file, diff: d });
    }
  }
  flat.sort((x, y) => y.diff.ts - x.diff.ts);

  let chars = 0;
  const taken: Array<{ file: string; diff: TrailDiff }> = [];
  for (const row of flat) {
    if (taken.length >= maxDiffs) {
      break;
    }
    if (chars + row.diff.diff.length > budget && taken.length > 0) {
      break;
    }
    chars += row.diff.diff.length;
    taken.push(row);
  }

  // Regroup per file; sort diffs oldest→newest within a file and files by
  // most-recent diff ascending so the newest activity is last.
  const grouped = new Map<string, TrailDiff[]>();
  for (const row of taken) {
    const list = grouped.get(row.file) ?? [];
    list.push(row.diff);
    grouped.set(row.file, list);
  }
  const entries: DiffHistorySnapshotEntry[] = [];
  for (const [file, diffs] of grouped) {
    diffs.sort((x, y) => x.ts - y.ts);
    entries.push({
      file,
      diffs: diffs.map((d) => d.diff),
      timestamps: diffs.map((d) => d.ts),
    });
  }
  entries.sort(
    (x, y) =>
      (x.timestamps[x.timestamps.length - 1] ?? 0) -
      (y.timestamps[y.timestamps.length - 1] ?? 0),
  );
  return entries;
}
