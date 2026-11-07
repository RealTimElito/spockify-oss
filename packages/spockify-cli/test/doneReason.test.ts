import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { doneReason } from '@spockify/harness';

const profile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../spockify-harness/fixtures/profile-v0/events.jsonl',
);
const parity = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../spockify-harness/fixtures/cli-ide-parity/events.jsonl',
);

describe('CLI/IDE fixture parity', () => {
  it('profile-v0 done.reason matches doneReason()', () => {
    const lines = fs.readFileSync(profile, 'utf8').trim().split('\n');
    const last = JSON.parse(lines.at(-1)!) as {
      type: string;
      cancelled?: boolean;
      reason?: string;
    };
    assert.equal(last.type, 'done');
    assert.equal(doneReason(last), 'unverified');
    assert.equal(doneReason({ cancelled: true }), 'cancelled');
    assert.equal(doneReason({ reason: 'verified' }), 'verified');
  });

  it('cli-ide-parity jsonl maps every disposition identically', () => {
    const reasons = fs
      .readFileSync(parity, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; cancelled?: boolean; reason?: string })
      .filter((ev) => ev.type === 'done')
      .map((ev) => doneReason(ev));
    assert.deepEqual(reasons, [
      'unverified',
      'verified',
      'cancelled',
      'exhausted',
      'failed',
      'blocked',
      'cancelled',
    ]);
  });
});
