import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  KeyParser,
  applyComposerKey,
  composerText,
  createComposer,
  layoutWrap,
  moveUp,
  segmentGraphemes,
  setComposerText,
} from '../src/composerBuffer';

describe('composerBuffer word ops', () => {
  it('Ctrl+Left then delete-word leaves "hello "', () => {
    const st = createComposer();
    setComposerText(st, 'hello world');
    applyComposerKey(st, { type: 'wordLeft' }, 80);
    assert.equal(st.caret, 6);
    assert.equal(composerText(st).slice(st.caret), 'world');
    // At start of "world": Ctrl+Delete / kill-forward-word → "hello "
    applyComposerKey(st, { type: 'deleteWordRight' }, 80);
    assert.equal(composerText(st), 'hello ');
    assert.equal(st.caret, 6);
  });

  it('Ctrl+Backspace from end deletes previous word', () => {
    const st = createComposer();
    setComposerText(st, 'hello world');
    applyComposerKey(st, { type: 'deleteWordLeft' }, 80);
    assert.equal(composerText(st), 'hello ');
  });

  it('KeyParser maps CSI word left and Ctrl+W', () => {
    const p = new KeyParser();
    assert.deepEqual(p.push('\x1b[1;5D'), [{ type: 'wordLeft' }]);
    assert.deepEqual(p.push('\x17'), [{ type: 'deleteWordLeft' }]);
    assert.deepEqual(p.push('\x08'), [{ type: 'deleteWordLeft' }]);
    assert.deepEqual(p.push('\x7f'), [{ type: 'backspace' }]);
    assert.deepEqual(p.push('\x1b[3;5~'), [{ type: 'deleteWordRight' }]);
  });
});

describe('composerBuffer wrap + caret', () => {
  it('wraps a 200-char string and reports caret row/col', () => {
    const width = 40;
    const text = 'a'.repeat(200);
    const g = segmentGraphemes(text);
    const caret = 85; // mid-buffer
    const lay = layoutWrap(g, caret, width, 8, 0);
    assert.equal(lay.rows.length, 5); // 200 / 40
    assert.equal(lay.caretRow, Math.floor(85 / width));
    assert.equal(lay.caretCol, 85 % width);
    assert.ok(lay.visibleRows.length <= 8);
    assert.equal(lay.visibleRows.length, 5);
    assert.ok(lay.caretRow >= lay.scrollTop);
    assert.ok(lay.caretRow < lay.scrollTop + lay.visibleRows.length);
  });

  it('scrolls inside the input region when taller than max rows', () => {
    const width = 40;
    const g = segmentGraphemes('b'.repeat(400)); // 10 rows
    const caret = 399;
    const lay = layoutWrap(g, caret, width, 8, 0);
    assert.equal(lay.rows.length, 10);
    assert.equal(lay.visibleRows.length, 8);
    assert.equal(lay.scrollTop, 2);
    assert.equal(lay.caretRow, 9);
  });

  it('Up at top of wrapped line pulls history', () => {
    const st = createComposer(['prior prompt']);
    setComposerText(st, 'a'.repeat(50));
    st.caret = 0;
    const width = 20;
    const lay = layoutWrap(st.graphemes, st.caret, width, 8, 0);
    assert.ok(lay.rows.length > 1);
    assert.equal(lay.caretRow, 0);
    const changed = moveUp(st, width);
    assert.equal(changed, true);
    assert.equal(composerText(st), 'prior prompt');
  });

  it('Up moves between wrapped rows before history', () => {
    const st = createComposer(['hist']);
    setComposerText(st, 'a'.repeat(50));
    st.caret = 45;
    const width = 20;
    const before = layoutWrap(st.graphemes, st.caret, width, 8, 0);
    assert.ok(before.caretRow > 0);
    const changed = moveUp(st, width);
    assert.equal(changed, false);
    const after = layoutWrap(st.graphemes, st.caret, width, 8, st.scrollTop);
    assert.equal(after.caretRow, before.caretRow - 1);
    assert.equal(composerText(st), 'a'.repeat(50));
  });
});

describe('UTF-8 / grapheme delete', () => {
  it('backspace removes one emoji grapheme', () => {
    const st = createComposer();
    setComposerText(st, 'hi👋');
    applyComposerKey(st, { type: 'backspace' }, 80);
    assert.equal(composerText(st), 'hi');
  });
});
