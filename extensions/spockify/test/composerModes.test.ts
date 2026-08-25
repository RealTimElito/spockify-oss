import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMPOSER_UI_MODES,
  composerUiModeAddon,
  normalizeComposerUiMode,
  toRuntimeAgentMode,
} from '../src/chat/composerModes';

describe('composerModes', () => {
  it('maps Cursor UI modes to runtime tool policy', () => {
    assert.equal(toRuntimeAgentMode('agent'), 'agent');
    assert.equal(toRuntimeAgentMode('ask'), 'ask');
    assert.equal(toRuntimeAgentMode('plan'), 'agent');
    assert.equal(toRuntimeAgentMode('debug'), 'agent');
    assert.equal(toRuntimeAgentMode('multitask'), 'agent');
    assert.equal(toRuntimeAgentMode('strict'), 'strict');
  });

  it('normalizes unknown / legacy values', () => {
    assert.equal(normalizeComposerUiMode('plan'), 'plan');
    assert.equal(normalizeComposerUiMode('strict'), 'agent');
    assert.equal(normalizeComposerUiMode('nope', 'ask'), 'ask');
  });

  it('exposes five Cursor-like UI modes', () => {
    assert.deepEqual([...COMPOSER_UI_MODES], [
      'agent',
      'plan',
      'debug',
      'multitask',
      'ask',
    ]);
  });

  it('adds system hints for plan/debug/multitask only', () => {
    assert.match(composerUiModeAddon('plan'), /PLAN/);
    assert.match(composerUiModeAddon('debug'), /DEBUG/);
    assert.match(composerUiModeAddon('multitask'), /MULTITASK/);
    assert.match(
      composerUiModeAddon('multitask'),
      /ONLY when the user explicitly asks/i,
    );
    assert.equal(composerUiModeAddon('agent'), '');
    assert.equal(composerUiModeAddon('ask'), '');
  });
});
