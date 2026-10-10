/**
 * Tests for AI commit-message helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCommitMessageUserPrompt,
  cleanCommitMessage,
  isEmptyDiff,
  isValidConventionalCommit,
  looksLikeCommitNarration,
  rewriteNarrationToConventional,
  truncateDiff,
  MAX_DIFF_CHARS,
  COMMIT_MESSAGE_SYSTEM,
} from '../src/git/commitMessage';

describe('cleanCommitMessage', () => {
  it('strips text fences', () => {
    assert.equal(
      cleanCommitMessage('```text\nfeat: add login\n\nBody here.\n```'),
      'feat: add login\n\nBody here.',
    );
  });

  it('strips Commit message: prefix', () => {
    assert.equal(
      cleanCommitMessage('Commit message: fix: handle empty diff'),
      'fix: handle empty diff',
    );
  });

  it('unwraps quoted single-line subject', () => {
    assert.equal(cleanCommitMessage('"chore: bump version"'), 'chore: bump version');
  });

  it('returns empty for blank', () => {
    assert.equal(cleanCommitMessage('   '), '');
  });

  it('keeps conventional subject after meta preamble', () => {
    assert.equal(
      cleanCommitMessage(
        'Thus this commit is a feature addition covering many files.\n\n' +
          'feat: improve commit message prompts for SCM generate',
      ),
      'feat: improve commit message prompts for SCM generate',
    );
  });

  it('drops trailing meta after subject', () => {
    const out = cleanCommitMessage(
      'feat: tighten generate-commit-message prompts\n\n' +
        'Thus this commit could be feat or chore depending on view.',
    );
    assert.equal(out, 'feat: tighten generate-commit-message prompts');
  });

  it('rewrites laundry-list narration into conventional subject', () => {
    const out = cleanCommitMessage(
      'We need to craft a commit message summarizing the change. The diff includes many updates:\n\n' +
        '- Bump version from 0.9.3 to 0.9.4 across product overlay, extension package.json, various code constants.\n' +
        '- Update generateCommitMessage.ts max_tokens reduction and comment.\n' +
        '- Extend COMMIT_MESSAGE_SYSTEM constant with more detailed instructions.\n',
    );
    assert.match(out, /^(feat|fix|refactor|docs|test|chore|perf|build|ci|style)(\([^)]+\))?!?:\s+\S/);
    assert.doesNotMatch(out, /We need to craft/i);
    assert.doesNotMatch(out, /^\s*[-*]/m);
    assert.ok(isValidConventionalCommit(out));
  });

  it('rewrites overall-intent laundry list', () => {
    const out = cleanCommitMessage(
      'We need to craft conventional commit message summarizing changes.\n\n' +
        'Changes:\n\n' +
        '- Bump spockifyIdeVersion from 0.9.3 to 0.9.4 in product.overlay.json.\n' +
        '- Adjust max_tokens from 256 to 120 with comment.\n' +
        '- Update commitMessage.ts strings.\n\n' +
        'Overall intent: update version to 0.9.4 and tighten AI token budget',
    );
    assert.ok(isValidConventionalCommit(out));
    assert.match(out, /chore:/);
    assert.match(out, /0\.9\.4|commit-message|commit message/i);
  });
});

describe('looksLikeCommitNarration', () => {
  it('flags laundry lists', () => {
    assert.equal(
      looksLikeCommitNarration(
        'We need to craft a commit message.\n\n- Bump version\n- Update prompts',
      ),
      true,
    );
  });

  it('accepts conventional subjects', () => {
    assert.equal(
      looksLikeCommitNarration('chore: tighten commit-message prompts'),
      false,
    );
  });
});

describe('rewriteNarrationToConventional', () => {
  it('summarizes version + prompt changes', () => {
    const out = rewriteNarrationToConventional(
      '- Bump version to 0.9.4\n- Extend COMMIT_MESSAGE_SYSTEM prompts\n- Reduce max_tokens',
    );
    assert.match(out, /^chore:/);
    assert.match(out, /0\.9\.4|commit-message|prompt/i);
  });
});

describe('COMMIT_MESSAGE_SYSTEM', () => {
  it('bans laundry lists and meta narration', () => {
    assert.match(COMMIT_MESSAGE_SYSTEM, /Conventional Commits/i);
    assert.match(COMMIT_MESSAGE_SYSTEM, /laundry.?list/i);
    assert.match(COMMIT_MESSAGE_SYSTEM, /GOOD examples/i);
    assert.match(COMMIT_MESSAGE_SYSTEM, /BAD examples/i);
    assert.match(COMMIT_MESSAGE_SYSTEM, /We need to craft/i);
  });
});

describe('truncateDiff', () => {
  it('leaves short diffs alone', () => {
    assert.equal(truncateDiff('abc'), 'abc');
  });

  it('truncates long diffs', () => {
    const long = 'x'.repeat(MAX_DIFF_CHARS + 500);
    const out = truncateDiff(long);
    assert.ok(out.includes('truncated'));
    assert.ok(out.length < long.length);
    assert.ok(out.startsWith('x'.repeat(100)));
  });
});

describe('buildCommitMessageUserPrompt', () => {
  it('marks staged vs unstaged', () => {
    const staged = buildCommitMessageUserPrompt({
      diff: '+a\n',
      staged: true,
      repoName: 'agentHub',
      branchName: 'main',
      recentSubjects: ['feat: prior'],
    });
    assert.match(staged, /staged changes/i);
    assert.match(staged, /Repository: agentHub/);
    assert.match(staged, /feat: prior/);
    assert.match(staged, /No bullets/i);
    assert.match(staged, /Write the commit message now/i);

    const unstaged = buildCommitMessageUserPrompt({
      diff: '+b\n',
      staged: false,
    });
    assert.match(unstaged, /unstaged/i);
  });
});

describe('isEmptyDiff', () => {
  it('detects empty', () => {
    assert.equal(isEmptyDiff(''), true);
    assert.equal(isEmptyDiff('  \n'), true);
    assert.equal(isEmptyDiff('diff --git'), false);
  });
});
