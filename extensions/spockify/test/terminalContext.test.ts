/**
 * Terminal context helpers for chat / Ctrl+L
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTerminalContextSection,
  stripAnsi,
  tailTerminalLines,
} from '../src/terminal/contextFormat';

describe('terminal context', () => {
  it('stripAnsi removes color sequences', () => {
    const raw = '\x1b[31merror\x1b[0m ok';
    assert.equal(stripAnsi(raw), 'error ok');
  });

  it('tailTerminalLines keeps last N lines', () => {
    const text = 'a\nb\nc\nd\ne';
    assert.equal(tailTerminalLines(text, 2), 'd\ne');
  });

  it('formatTerminalContextSection includes selection and output', () => {
    const block = formatTerminalContextSection({
      name: 'bash',
      selection: 'npm test',
      recentOutput: 'FAIL 1 test',
      isEmpty: false,
    });
    assert.ok(block.includes('@terminal (bash)'));
    assert.ok(block.includes('npm test'));
    assert.ok(block.includes('FAIL 1 test'));
  });

  it('formatTerminalContextSection empty snapshot', () => {
    assert.equal(
      formatTerminalContextSection({
        name: 'zsh',
        recentOutput: '',
        isEmpty: true,
      }),
      '',
    );
  });
});
