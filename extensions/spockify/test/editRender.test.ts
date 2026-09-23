/**
 * Line-range EDIT → inline-completion collapse (protocol v2)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collapseEditToCursorLine } from '../src/complete/editRender';

const doc = [
  'function add(a, b) {',
  '  return a - b;',
  '}',
  '',
  'const x = 1;',
];

describe('collapseEditToCursorLine', () => {
  it('single-line edit at cursor line renders', () => {
    const out = collapseEditToCursorLine(
      doc,
      { start_line: 1, end_line: 1, new_text: '  return a + b;' },
      1,
      2,
    );
    assert.ok(out);
    assert.equal(out.line, 1);
    assert.equal(out.insertText, '  return a + b;');
  });

  it('multi-line edit that only changes the cursor line collapses', () => {
    const out = collapseEditToCursorLine(
      doc,
      {
        start_line: 0,
        end_line: 2,
        new_text: 'function add(a, b) {\n  return a + b;\n}',
      },
      1,
      0,
    );
    assert.ok(out);
    assert.equal(out.line, 1);
    assert.equal(out.insertText, '  return a + b;');
  });

  it('cursor line expanding into several lines collapses', () => {
    const out = collapseEditToCursorLine(
      doc,
      {
        start_line: 1,
        end_line: 1,
        new_text: '  const sum = a + b;\n  return sum;',
      },
      1,
      2,
    );
    assert.ok(out);
    assert.equal(out.insertText, '  const sum = a + b;\n  return sum;');
  });

  it('rejects edits changing lines other than the cursor line', () => {
    const out = collapseEditToCursorLine(
      doc,
      {
        start_line: 0,
        end_line: 2,
        new_text: 'function add(a, b) {\n  return a - b;\n}}',
      },
      1,
      0,
    );
    assert.equal(out, undefined);
  });

  it('rejects when typed prefix is not preserved', () => {
    const out = collapseEditToCursorLine(
      doc,
      { start_line: 1, end_line: 1, new_text: 'return a + b;' },
      1,
      4, // cursor after "  re" — replacement must start with that
    );
    assert.equal(out, undefined);
  });

  it('rejects pure deletions and no-ops', () => {
    assert.equal(
      collapseEditToCursorLine(
        doc,
        { start_line: 1, end_line: 1, new_text: '  return a - b;' },
        1,
        0,
      ),
      undefined,
    );
  });

  it('rejects out-of-range and cursor-outside edits', () => {
    assert.equal(
      collapseEditToCursorLine(
        doc,
        { start_line: 4, end_line: 9, new_text: 'x' },
        4,
        0,
      ),
      undefined,
    );
    assert.equal(
      collapseEditToCursorLine(
        doc,
        { start_line: 0, end_line: 1, new_text: 'a\nb' },
        3,
        0,
      ),
      undefined,
    );
  });
});
