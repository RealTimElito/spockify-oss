/**
 * CLI/IDE contract: both clients derive the same terminal evidence
 * from shared harness events. Not Cursor-complete; interrupt/resume
 * is covered in resume.test.ts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { doneReason, type TerminalDisposition } from '../src/index';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/cli-ide-parity/events.jsonl',
);

const EXPECTED: TerminalDisposition[] = [
  'unverified',
  'verified',
  'cancelled',
  'exhausted',
  'failed',
  'blocked',
  'cancelled',
];

export function doneReasonsFromFixture(file = fixture): TerminalDisposition[] {
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; cancelled?: boolean; reason?: string })
    .filter((ev) => ev.type === 'done')
    .map((ev) => doneReason(ev));
}

describe('CLI/IDE fixture parity', () => {
  it('shared jsonl yields the same done.reason sequence for every client', () => {
    const reasons = doneReasonsFromFixture();
    assert.deepEqual(reasons, EXPECTED);
  });
});
