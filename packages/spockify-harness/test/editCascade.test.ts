import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyEditCascade } from '../src/editCascade';

describe('editCascade', () => {
  it('L0 exact', () => {
    const r = applyEditCascade('abc', 'b', 'B');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 0);
      assert.equal(r.text, 'aBc');
      assert.ok(r.diff.includes('-') || r.diff.includes('before'));
    }
  });

  it('L1 trailing whitespace still edits', () => {
    const r = applyEditCascade('foo  \nbar\n', 'foo\nbar', 'baz');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 1);
      assert.match(r.text, /baz/);
    }
  });

  it('L1 fails the suite if cascade never reaches ws-norm', () => {
    // Exact miss + ws-norm hit is the product gap; layer must be 1 not 0.
    const file = 'def greet(name):\n    return f"hi {name}"  \n';
    const search = 'def greet(name):\n    return f"hi {name}"\n';
    assert.equal(file.includes(search), false);
    const r = applyEditCascade(file, search, 'def greet(name):\n    return f"hello {name}"\n');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('L1 must run');
    assert.equal(r.layer, 1);
    assert.match(r.text, /hello/);
  });

  it('L2 first/last-line anchors', () => {
    const text = 'keep\nstart here\nmiddle junk\nend here\nkeep2\n';
    const search = 'start here\nOLD\nend here';
    const r = applyEditCascade(text, search, 'start here\nNEW\nend here');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 2);
      assert.match(r.text, /NEW/);
      assert.doesNotMatch(r.text, /middle junk/);
    }
  });

  it('L2 fails the suite if anchors never run', () => {
    const text = 'a\nstart\nDRIFT LINE\nend\nz\n';
    const search = 'start\nMISSING\nend';
    const r = applyEditCascade(text, search, 'start\nFIXED\nend');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('L2 must run');
    assert.equal(r.layer, 2);
    assert.match(r.text, /FIXED/);
  });

  it('L4 refuse blind overwrite and return the failing hunk', () => {
    const search = 'nope_unique_hunk_xyz';
    const r = applyEditCascade('secret', search, 'wipe');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.layerTried, 4);
      assert.match(r.error, /failing hunk/);
      assert.match(r.error, /nope_unique_hunk_xyz/);
    }
  });

  it('L4 allow when just-read', () => {
    const r = applyEditCascade('secret', '', 'wipe', {
      allowOverwrite: true,
      justRead: true,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 4);
      assert.equal(r.text, 'wipe');
    }
  });
});
