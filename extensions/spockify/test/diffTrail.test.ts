/**
 * Tab diff-history trail core (protocol v2)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeUnifiedDiff,
  pushTrailDiff,
  snapshotTrails,
  TRAIL_MAX_DIFFS_PER_FILE,
  TRAIL_MAX_FILES,
  TRAIL_SNAPSHOT_CHAR_BUDGET,
  TRAIL_SNAPSHOT_MAX_DIFFS,
  type FileTrail,
} from '../src/complete/diffTrail';

describe('computeUnifiedDiff', () => {
  it('empty on identical text', () => {
    assert.equal(computeUnifiedDiff('a\nb', 'a\nb', 'f.ts'), '');
  });

  it('single changed line yields one hunk', () => {
    const diff = computeUnifiedDiff('a\nb\nc', 'a\nB\nc', 'src/f.ts');
    assert.ok(diff.includes('--- a/src/f.ts'));
    assert.ok(diff.includes('+++ b/src/f.ts'));
    assert.ok(diff.includes('@@ -2,1 +2,1 @@'));
    assert.ok(diff.includes('-b'));
    assert.ok(diff.includes('+B'));
  });

  it('pure insertion has zero-length old range', () => {
    const diff = computeUnifiedDiff('a\nc', 'a\nb\nc', 'f.ts');
    assert.ok(diff.includes('@@ -1,0 +2,1 @@'));
    assert.ok(diff.includes('+b'));
    assert.ok(!diff.includes('\n-'));
  });

  it('caps giant diffs', () => {
    const before = 'x';
    const after = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const diff = computeUnifiedDiff(before, after, 'f.ts');
    assert.ok(diff.length < 800);
    assert.ok(diff.includes('…(truncated)'));
  });
});

describe('trail caps', () => {
  it('keeps last N diffs per file', () => {
    const trails = new Map<string, FileTrail>();
    for (let i = 0; i < TRAIL_MAX_DIFFS_PER_FILE + 5; i++) {
      pushTrailDiff(trails, 'a.ts', `diff-${i}`, i);
    }
    const trail = trails.get('a.ts')!;
    assert.equal(trail.diffs.length, TRAIL_MAX_DIFFS_PER_FILE);
    assert.equal(trail.diffs[trail.diffs.length - 1].diff, 'diff-14');
  });

  it('keeps only most recently edited files', () => {
    const trails = new Map<string, FileTrail>();
    for (let i = 0; i < TRAIL_MAX_FILES + 3; i++) {
      pushTrailDiff(trails, `f${i}.ts`, 'd', i);
    }
    assert.equal(trails.size, TRAIL_MAX_FILES);
    assert.ok(!trails.has('f0.ts'));
    assert.ok(trails.has(`f${TRAIL_MAX_FILES + 2}.ts`));
  });
});

describe('snapshotTrails', () => {
  it('orders entries newest-file-last, diffs oldest-first', () => {
    const trails = new Map<string, FileTrail>();
    pushTrailDiff(trails, 'old.ts', 'o1', 100);
    pushTrailDiff(trails, 'new.ts', 'n1', 200);
    pushTrailDiff(trails, 'new.ts', 'n2', 300);
    const snap = snapshotTrails(trails);
    assert.equal(snap.length, 2);
    assert.equal(snap[0].file, 'old.ts');
    assert.equal(snap[1].file, 'new.ts');
    assert.deepEqual(snap[1].diffs, ['n1', 'n2']);
    assert.deepEqual(snap[1].timestamps, [200, 300]);
  });

  it('enforces char budget preferring newest diffs', () => {
    const trails = new Map<string, FileTrail>();
    const big = 'x'.repeat(TRAIL_SNAPSHOT_CHAR_BUDGET - 5);
    pushTrailDiff(trails, 'a.ts', big, 1);
    pushTrailDiff(trails, 'b.ts', 'small-new', 2);
    const snap = snapshotTrails(trails);
    const all = snap.flatMap((e) => e.diffs);
    assert.ok(all.includes('small-new'));
    assert.ok(!all.includes(big));
  });

  it('enforces max diff count', () => {
    const trails = new Map<string, FileTrail>();
    for (let i = 0; i < TRAIL_SNAPSHOT_MAX_DIFFS + 4; i++) {
      pushTrailDiff(trails, 'a.ts', `d${i}`, i);
    }
    pushTrailDiff(trails, 'b.ts', 'e', 100);
    const snap = snapshotTrails(trails);
    const count = snap.reduce((n, e) => n + e.diffs.length, 0);
    assert.ok(count <= TRAIL_SNAPSHOT_MAX_DIFFS);
  });
});
