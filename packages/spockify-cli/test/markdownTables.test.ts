import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMarkdownTables,
  holdIncompleteTable,
} from '../src/ui';

const sample = [
  '| Item | Details |',
  '|------|---------|',
  '| Campaign | spark-gb10 |',
  '| Autonomy | L0 |',
  '',
  'After.',
].join('\n');

test('formatMarkdownTables pads a GFM table', () => {
  const out = formatMarkdownTables(sample, 80);
  assert.match(out, /┌/);
  assert.match(out, /Campaign/);
  assert.match(out, /spark-gb10/);
  assert.match(out, /After\./);
  assert.doesNotMatch(out, /\|------/);
});

test('holdIncompleteTable keeps an open table in the buffer', () => {
  const partial = '| Item | Details |\n|------|---------|';
  assert.ok(holdIncompleteTable(partial) > 0);
  const done = `${sample}\n`;
  assert.equal(holdIncompleteTable(done), 0);
});
