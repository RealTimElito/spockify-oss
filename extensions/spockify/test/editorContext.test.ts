/**
 * Ctrl+L editor attach flags + selection chip helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  editorAttachFlagsFromSnapshot,
  selectionChipFromSnapshot,
  selectionDisplayRange,
  upsertSelectionChip,
} from '../src/rules/editorAttach';

describe('editorAttachFlagsFromSnapshot', () => {
  it('prefers selection when non-empty', () => {
    const flags = editorAttachFlagsFromSnapshot({
      fileName: '/x/a.ts',
      filePath: '/x/a.ts',
      selectionText: 'hello',
      fileText: 'hello world',
      hasNonemptySelection: true,
      startLine: 1,
      endLine: 1,
    });
    assert.deepEqual(flags, {
      includeSelection: true,
      includeActiveFile: false,
    });
  });

  it('uses active file when selection empty', () => {
    const flags = editorAttachFlagsFromSnapshot({
      fileName: '/x/a.ts',
      filePath: '/x/a.ts',
      selectionText: '',
      fileText: 'hello world',
      hasNonemptySelection: false,
    });
    assert.deepEqual(flags, {
      includeSelection: false,
      includeActiveFile: true,
    });
  });

  it('no editor snapshot disables both', () => {
    assert.deepEqual(editorAttachFlagsFromSnapshot(undefined), {
      includeSelection: false,
      includeActiveFile: false,
    });
  });
});

describe('selectionDisplayRange', () => {
  it('uses 1-based inclusive lines', () => {
    assert.deepEqual(selectionDisplayRange(9, 0, 19, 5), {
      startLine: 10,
      endLine: 20,
    });
  });

  it('treats end at column 0 as exclusive line', () => {
    assert.deepEqual(selectionDisplayRange(9, 0, 20, 0), {
      startLine: 10,
      endLine: 20,
    });
  });
});

describe('selectionChipFromSnapshot', () => {
  it('builds Cursor-style chip label fields', () => {
    const chip = selectionChipFromSnapshot({
      fileName: '/home/you/spockify/docker-compose.yml',
      filePath: '/home/you/spockify/docker-compose.yml',
      selectionText: 'services:\n  api:',
      fileText: 'services:\n  api:\n',
      hasNonemptySelection: true,
      startLine: 10,
      endLine: 20,
    });
    assert.ok(chip);
    assert.equal(chip.fileName, 'docker-compose.yml');
    assert.equal(chip.startLine, 10);
    assert.equal(chip.endLine, 20);
    assert.equal(chip.id, '/home/you/spockify/docker-compose.yml:10-20');
  });

  it('returns undefined without selection', () => {
    assert.equal(
      selectionChipFromSnapshot({
        fileName: '/x/a.ts',
        filePath: '/x/a.ts',
        selectionText: '',
        fileText: 'x',
        hasNonemptySelection: false,
      }),
      undefined,
    );
  });
});

describe('upsertSelectionChip', () => {
  it('appends and replaces same range', () => {
    const a = {
      id: '/x/a.ts:1-2',
      fileName: 'a.ts',
      filePath: '/x/a.ts',
      startLine: 1,
      endLine: 2,
      text: 'one',
    };
    const b = {
      id: '/x/b.ts:3-4',
      fileName: 'b.ts',
      filePath: '/x/b.ts',
      startLine: 3,
      endLine: 4,
      text: 'two',
    };
    const a2 = { ...a, text: 'updated' };
    let chips = upsertSelectionChip([], a);
    chips = upsertSelectionChip(chips, b);
    assert.equal(chips.length, 2);
    chips = upsertSelectionChip(chips, a2);
    assert.equal(chips.length, 2);
    assert.equal(chips[1].text, 'updated');
    assert.equal(chips[1].id, a.id);
  });
});
