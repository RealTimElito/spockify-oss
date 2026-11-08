import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cybergymPhase, toolChoiceForPhase } from './phase';

const budget = 8;
const base = { exploreBudget: budget, maxSubmits: 3, feedbackBudget: 3 };

describe('cybergym phase', () => {
  it('explores, then forces write, then forces submit', () => {
    assert.equal(
      cybergymPhase({ ...base, exploreCalls: 7, writes: 0, submits: 0 }),
      'explore',
    );
    const writeChoice = toolChoiceForPhase(
      cybergymPhase({ ...base, exploreCalls: 8, writes: 0, submits: 0 }),
    );
    assert.equal(typeof writeChoice === 'object' && writeChoice.function.name, 'write_file');
    const submitChoice = toolChoiceForPhase(
      cybergymPhase({ ...base, exploreCalls: 8, writes: 1, submits: 0 }),
    );
    assert.equal(typeof submitChoice === 'object' && submitChoice.function.name, 'submit_poc');
  });

  it('after a non-solve, allows feedback explores then forces a new write and submit', () => {
    assert.equal(
      cybergymPhase({
        ...base,
        exploreCalls: 8,
        writes: 1,
        submits: 1,
        writesAtLastSubmit: 1,
        exploreCallsAtLastSubmit: 8,
        lastSolved: false,
      }),
      'feedback',
    );
    const feedbackChoice = toolChoiceForPhase(
      cybergymPhase({
        ...base,
        exploreCalls: 8,
        writes: 1,
        submits: 1,
        writesAtLastSubmit: 1,
        exploreCallsAtLastSubmit: 8,
      }),
    );
    assert.equal(typeof feedbackChoice === 'object' && feedbackChoice.function.name, 'read_file');
    assert.equal(
      cybergymPhase({
        ...base,
        exploreCalls: 11,
        writes: 1,
        submits: 1,
        writesAtLastSubmit: 1,
        exploreCallsAtLastSubmit: 8,
      }),
      'write',
    );
    const retrySubmit = toolChoiceForPhase(
      cybergymPhase({
        ...base,
        exploreCalls: 11,
        writes: 2,
        submits: 1,
        writesAtLastSubmit: 1,
        exploreCallsAtLastSubmit: 8,
      }),
    );
    assert.equal(typeof retrySubmit === 'object' && retrySubmit.function.name, 'submit_poc');
  });

  it('a vul crash that also crashes fix still iterates; a solve or the cap releases', () => {
    assert.equal(
      cybergymPhase({
        ...base,
        exploreCalls: 8,
        writes: 1,
        submits: 1,
        writesAtLastSubmit: 1,
        exploreCallsAtLastSubmit: 8,
        lastSolved: false,
      }),
      'feedback',
    );
    assert.equal(
      toolChoiceForPhase(
        cybergymPhase({
          ...base,
          exploreCalls: 12,
          writes: 2,
          submits: 1,
          writesAtLastSubmit: 2,
          exploreCallsAtLastSubmit: 12,
          lastSolved: true,
        }),
      ),
      'auto',
    );
    assert.equal(
      toolChoiceForPhase(
        cybergymPhase({
          ...base,
          exploreCalls: 14,
          writes: 3,
          submits: 3,
          writesAtLastSubmit: 3,
          exploreCallsAtLastSubmit: 14,
          lastSolved: false,
        }),
      ),
      'auto',
    );
  });

  it('identical-byte rejection forces another write', () => {
    assert.equal(
      cybergymPhase({
        ...base,
        exploreCalls: 11,
        writes: 2,
        submits: 1,
        writesAtLastSubmit: 2,
        exploreCallsAtLastSubmit: 11,
        needNewWrite: true,
      }),
      'write',
    );
  });
});
