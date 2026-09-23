import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_THINKING_MODE,
  migratePersistedThinking,
  nextThinkingMode,
  normalizeThinkingMode,
  thinkingMarker,
  thinkingRequestFields,
  withThinkingMarker,
} from '../src/chat/thinkingModes';

describe('thinkingModes', () => {
  it('defaults to High for the IDE Agent', () => {
    assert.equal(DEFAULT_THINKING_MODE, 'high');
    assert.equal(normalizeThinkingMode('nope'), 'high');
  });

  it('cycles Off → Low → Medium → High → Heavy → Off', () => {
    assert.equal(nextThinkingMode('off'), 'low');
    assert.equal(nextThinkingMode('low'), 'medium');
    assert.equal(nextThinkingMode('medium'), 'high');
    assert.equal(nextThinkingMode('high'), 'heavy');
    assert.equal(nextThinkingMode('heavy'), 'off');
  });

  it('migrates Light and think-off', () => {
    assert.equal(normalizeThinkingMode('light'), 'low');
    assert.equal(migratePersistedThinking('medium', 'false'), 'off');
    assert.equal(migratePersistedThinking(undefined, undefined, true), 'high');
    assert.equal(migratePersistedThinking('heavy'), 'heavy');
  });

  it('omits think-enabled when Off and injects a system marker', () => {
    assert.deepEqual(thinkingRequestFields('off'), {
      spockify_thinking: 'off',
      spockify_think_enabled: false,
    });
    assert.deepEqual(thinkingRequestFields('high'), {
      spockify_thinking: 'high',
      spockify_think_enabled: true,
    });
    const msgs = withThinkingMarker(
      [{ role: 'user', content: 'hi' }],
      'heavy',
    );
    assert.equal(msgs[0].content, thinkingMarker('heavy'));
    assert.equal(msgs[1].content, 'hi');
  });
});
