import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LoopDetector } from '../src/loopDetect';

describe('loopDetect', () => {
  it('warns after threshold identical signatures', () => {
    const d = new LoopDetector({ window: 20, threshold: 5 });
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const sig = d.signature('grep', { pattern: 'x' }, 'hit');
      last = d.observe(sig);
    }
    assert.equal(last, 6);
    assert.equal(d.shouldWarn(last), true);
  });

  it('reset clears counts', () => {
    const d = new LoopDetector({ threshold: 2 });
    const sig = d.signature('a', {}, 'b');
    d.observe(sig);
    d.observe(sig);
    d.reset();
    assert.equal(d.observe(sig), 1);
  });

  it('disabled never warns', () => {
    const d = new LoopDetector({ enabled: false, threshold: 1 });
    const sig = d.signature('a', {}, 'b');
    assert.equal(d.observe(sig), 0);
    assert.equal(d.shouldWarn(99), false);
  });
});
