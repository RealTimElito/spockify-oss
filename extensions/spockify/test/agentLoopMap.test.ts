import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { doneReason, type HarnessEvent } from '@spockify/harness';
import { mapEvent } from '../src/runtime/agentLoopMap';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/spockify-harness/fixtures/profile-v0/events.jsonl',
);
const parity = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/spockify-harness/fixtures/cli-ide-parity/events.jsonl',
);

describe('IDE mapEvent fixture parity', () => {
  it('preserves done.reason from the shared profile fixture', () => {
    const lines = fs.readFileSync(fixture, 'utf8').trim().split('\n');
    const last = JSON.parse(lines.at(-1)!) as HarnessEvent;
    const mapped = mapEvent(last);
    assert.equal(mapped?.type, 'done');
    if (mapped?.type !== 'done') throw new Error('expected done');
    assert.equal(mapped.reason, 'unverified');
    assert.equal(mapped.reason, doneReason(last));
  });

  it('cli-ide-parity jsonl matches doneReason() after mapEvent', () => {
    const mappedReasons = fs
      .readFileSync(parity, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as HarnessEvent)
      .filter((ev) => ev.type === 'done')
      .map((ev) => {
        const mapped = mapEvent(ev);
        assert.equal(mapped?.type, 'done');
        if (mapped?.type !== 'done') throw new Error('expected done');
        assert.equal(mapped.reason, doneReason(ev));
        return mapped.reason;
      });
    assert.deepEqual(mappedReasons, [
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
