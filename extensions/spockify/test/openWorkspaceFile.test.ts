/**
 * Workspace path resolution helpers (no vscode mock required).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizePathHint,
  scorePathMatch,
} from '../src/chat/pathResolve.ts';

describe('normalizePathHint', () => {
  it('strips quotes and ./ but keeps absolute paths', () => {
    assert.equal(normalizePathHint('  "./safer/a.py"  '), 'safer/a.py');
    assert.equal(
      normalizePathHint('/home/you/safer/scripts/continuous_training.py'),
      '/home/you/safer/scripts/continuous_training.py',
    );
  });
});

describe('scorePathMatch', () => {
  it('prefers full relative suffix over basename', () => {
    const hint = 'safer/scripts/continuous_training.py';
    const full = scorePathMatch(
      '/ws/safer/scripts/continuous_training.py',
      hint,
    );
    const base = scorePathMatch(
      '/other/pkg/continuous_training.py',
      hint,
    );
    assert.ok(full > base);
    assert.ok(full >= 1000);
  });

  it('scores basename-only hints', () => {
    assert.ok(
      scorePathMatch(
        '/ws/safer/scripts/continuous_training.py',
        'continuous_training.py',
      ) >= 100,
    );
  });

  it('scores absolute hints', () => {
    const abs = '/home/you/safer/scripts/continuous_training.py';
    assert.ok(scorePathMatch(abs, abs) >= 900);
  });
});
