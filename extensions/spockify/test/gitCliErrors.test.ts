/**
 * Tests for error-string helpers (commit-message toasts must never be blank).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatGitCliFailure,
  isGitDiffDirtyExit,
  looksLikeGitFatalOutput,
} from '../src/git/gitCliErrors';
import { formatCaughtError } from '../src/util/errors';

describe('formatGitCliFailure', () => {
  it('prefers stderr', () => {
    assert.equal(
      formatGitCliFailure(['diff', '--cached'], {
        code: 128,
        stderr: 'fatal: not a git repository\n',
        stdout: '',
      }),
      'fatal: not a git repository',
    );
  });

  it('never returns blank when stderr is whitespace-only', () => {
    const msg = formatGitCliFailure(['rev-parse'], {
      code: 128,
      stderr: '\n  \n',
      stdout: '',
    });
    assert.ok(msg.length > 0);
    assert.match(msg, /git rev-parse failed \(exit 128\)/);
  });

  it('uses stdout when stderr empty (shellIntegration merge)', () => {
    assert.equal(
      formatGitCliFailure(['status'], {
        code: 128,
        stderr: '',
        stdout: 'fatal: not a git repository',
      }),
      'fatal: not a git repository',
    );
  });
});

describe('isGitDiffDirtyExit', () => {
  it('allows exit 1 only for diff', () => {
    assert.equal(isGitDiffDirtyExit(['diff'], 1), true);
    assert.equal(isGitDiffDirtyExit(['diff', '--cached'], 1), true);
    assert.equal(isGitDiffDirtyExit(['rev-parse'], 1), false);
    assert.equal(isGitDiffDirtyExit(['diff'], 128), false);
  });
});

describe('looksLikeGitFatalOutput', () => {
  it('detects fatal lines', () => {
    assert.equal(looksLikeGitFatalOutput('fatal: not a git repository'), true);
    assert.equal(looksLikeGitFatalOutput('diff --git a/x b/x'), false);
  });
});

describe('formatCaughtError', () => {
  it('uses Error.message when present', () => {
    assert.equal(formatCaughtError(new Error('boom')), 'boom');
  });

  it('never returns blank for empty Error.message', () => {
    const msg = formatCaughtError(new Error(''));
    assert.ok(msg.length > 0);
    assert.match(msg, /unknown error/i);
  });

  it('never returns blank for whitespace Error.message', () => {
    const msg = formatCaughtError(new Error('   \n'));
    assert.ok(msg.trim().length > 0);
  });

  it('uses stderr on Error-like objects with empty message', () => {
    const err = new Error('');
    (err as Error & { stderr: string }).stderr = 'remote git failed';
    assert.equal(formatCaughtError(err), 'remote git failed');
  });

  it('handles empty string throw', () => {
    const msg = formatCaughtError('');
    assert.ok(msg.length > 0);
  });
});
