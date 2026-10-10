import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAgentFamilyMode,
  shouldAttachCodebase,
} from '../src/codebase/attachPolicy';

describe('shouldAttachCodebase', () => {
  it('always attaches when explicit (@codebase chip / mention)', () => {
    assert.equal(
      shouldAttachCodebase({
        explicit: true,
        autoAttach: false,
        autoAttachAsk: false,
        uiMode: 'ask',
      }),
      true,
    );
  });

  it('auto-attaches in agent-family modes when setting on (regression: index unused)', () => {
    for (const mode of ['agent', 'plan', 'debug', 'multitask', 'strict']) {
      assert.equal(
        shouldAttachCodebase({
          explicit: false,
          autoAttach: true,
          autoAttachAsk: false,
          uiMode: mode,
        }),
        true,
        mode,
      );
    }
  });

  it('does not auto-attach when setting off', () => {
    assert.equal(
      shouldAttachCodebase({
        explicit: false,
        autoAttach: false,
        autoAttachAsk: true,
        uiMode: 'agent',
      }),
      false,
    );
  });

  it('Ask mode respects autoAttachAsk', () => {
    assert.equal(
      shouldAttachCodebase({
        explicit: false,
        autoAttach: true,
        autoAttachAsk: true,
        uiMode: 'ask',
      }),
      true,
    );
    assert.equal(
      shouldAttachCodebase({
        explicit: false,
        autoAttach: true,
        autoAttachAsk: false,
        uiMode: 'ask',
      }),
      false,
    );
  });

  it('isAgentFamilyMode', () => {
    assert.equal(isAgentFamilyMode('agent'), true);
    assert.equal(isAgentFamilyMode('ask'), false);
  });
});
