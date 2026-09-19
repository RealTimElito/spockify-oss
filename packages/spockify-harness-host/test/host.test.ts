import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_SPOCKIFY,
  listHarnesses,
  resolveHarnessOrFallback,
  commandDigest,
} from '../src/index';

describe('harness-host', () => {
  it('always includes spockify default', () => {
    const list = listHarnesses();
    assert.ok(list.some((h) => h.id === 'spockify'));
    assert.equal(DEFAULT_SPOCKIFY.id, 'spockify');
  });

  it('falls back when id unknown', () => {
    const r = resolveHarnessOrFallback('no-such-harness-xyz');
    assert.equal(r.harness.id, 'spockify');
    assert.ok(r.fallbackReason);
  });

  it('command digest is stable', () => {
    assert.equal(commandDigest(DEFAULT_SPOCKIFY).length, 12);
  });
});
