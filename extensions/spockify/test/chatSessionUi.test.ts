import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatChatRelativeTime,
  mergeSessionUi,
  normalizeContextChips,
  normalizeOpenTabIds,
  stepOpenTabId,
  tabTitleFromSummary,
} from '../src/chat/chatSessionUi';

describe('chatSessionUi', () => {
  it('mergeSessionUi keeps prior draft when patch omits it', () => {
    const merged = mergeSessionUi(
      { draft: 'hello', agentMode: 'ask' },
      { agentMode: 'agent' },
    );
    assert.equal(merged.draft, 'hello');
    assert.equal(merged.agentMode, 'agent');
  });

  it('stepOpenTabId wraps forward', () => {
    const ids = ['a', 'b', 'c'];
    assert.equal(stepOpenTabId(ids, 'c', 1), 'a');
    assert.equal(stepOpenTabId(ids, 'b', -1), 'a');
  });

  it('normalizeOpenTabIds promotes active id to front', () => {
    const ids = normalizeOpenTabIds(['a', 'b', 'c'], 'b');
    assert.deepEqual(ids.slice(0, 3), ['b', 'a', 'c']);
  });

  it('normalizeContextChips applies defaults', () => {
    assert.deepEqual(normalizeContextChips({ codebase: true }), {
      file: true,
      terminal: true,
      codebase: true,
      web: false,
    });
  });

  it('mergeSessionUi keeps selectionChips when patch omits them', () => {
    const chips = [
      {
        id: '/x/a.ts:1-2',
        fileName: 'a.ts',
        filePath: '/x/a.ts',
        startLine: 1,
        endLine: 2,
        text: 'hi',
      },
    ];
    const merged = mergeSessionUi(
      { draft: 'x', selectionChips: chips },
      { agentMode: 'ask' },
    );
    assert.deepEqual(merged.selectionChips, chips);
  });

  it('formatChatRelativeTime buckets', () => {
    const now = 1_700_000_000_000;
    assert.equal(formatChatRelativeTime(now - 20_000, now), 'Just now');
    assert.equal(formatChatRelativeTime(now - 120_000, now), '2 min ago');
    assert.match(formatChatRelativeTime(now - 86_400_000, now), /day/);
  });

  it('tabTitleFromSummary prefers draft for empty titles', () => {
    assert.equal(
      tabTitleFromSummary('Chat', 'Fix the login bug'),
      'Fix the login bug',
    );
  });
});
