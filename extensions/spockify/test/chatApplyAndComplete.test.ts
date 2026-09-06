/**
 * Tests for chat fence patch parsing + local Tab heuristics.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractCiteBeforeFence,
  parseChatFencePatches,
  parseFenceInfo,
  parseFilePatches,
  spliceLineRange,
} from '../src/composer/parsePatches';
import { suggestLocalCompletion } from '../src/complete/localHeuristics';

describe('parseFenceInfo', () => {
  it('parses Cursor start:end:path fences', () => {
    assert.deepEqual(parseFenceInfo('12:18:apps/foo/ports.ts'), {
      path: 'apps/foo/ports.ts',
      startLine: 12,
      endLine: 18,
    });
  });

  it('parses lang + path', () => {
    assert.deepEqual(parseFenceInfo('typescript src/a.ts'), {
      path: 'src/a.ts',
    });
  });

  it('ignores bare language tags', () => {
    assert.deepEqual(parseFenceInfo('typescript'), {});
    assert.deepEqual(parseFenceInfo('python'), {});
  });
});

describe('parseChatFencePatches', () => {
  it('parses path-tagged fence', () => {
    const text = 'Fix:\n```src/a.ts\nconst x = 1;\n```\n';
    const p = parseChatFencePatches(text);
    assert.equal(p.length, 1);
    assert.equal(p[0].path, 'src/a.ts');
    assert.equal(p[0].content, 'const x = 1;');
  });

  it('parses Cursor fence header without mangling path', () => {
    const text = '```10:12:pkg/ports.ts\n  foo: 1,\n```\n';
    const p = parseChatFencePatches(text);
    assert.equal(p.length, 1);
    assert.equal(p[0].path, 'pkg/ports.ts');
    assert.equal(p[0].startLine, 10);
    assert.equal(p[0].endLine, 12);
  });

  it('uses cite before language fence', () => {
    const text =
      'Update `apps/config/ports.ts:40-45`:\n\n```typescript\n  overwater: 8108,\n```\n';
    const p = parseChatFencePatches(text);
    assert.equal(p.length, 1);
    assert.equal(p[0].path, 'apps/config/ports.ts');
    assert.equal(p[0].startLine, 40);
    assert.equal(p[0].endLine, 45);
  });

  it('parseFilePatches returns single-file patches (length 1)', () => {
    const text = '```foo/bar.ts\nx\n```';
    const p = parseFilePatches(text);
    assert.equal(p.length, 1);
  });
});

describe('extractCiteBeforeFence + splice', () => {
  it('extracts backtick path:range', () => {
    const cite = extractCiteBeforeFence('see `src/a.ts:3-5`:\n\n');
    assert.ok(cite);
    assert.equal(cite!.path, 'src/a.ts');
    assert.equal(cite!.startLine, 3);
    assert.equal(cite!.endLine, 5);
  });

  it('splices line range', () => {
    const cur = 'a\nb\nc\nd\n';
    const next = spliceLineRange(cur, 2, 3, 'B\nC');
    assert.equal(next, 'a\nB\nC\nd\n');
  });
});

describe('local heuristics', () => {
  it('suggests missing comma before next object key', () => {
    const full = '{\n  detertech: 8105\n  overwater: 8108,\n}\n';
    const offset = full.indexOf('8105') + '8105'.length;
    const r = suggestLocalCompletion(full, offset, 'typescript');
    assert.ok(r);
    assert.equal(r!.insert, ',');
    assert.equal(r!.reason, 'missing-comma');
  });

  it('suggests next sequential port number', () => {
    const full = [
      'const LOCAL_API_DEBUG_PORTS = {',
      '  a: 8100,',
      '  b: 8101,',
      '  c: 8102,',
      '  d: 8103,',
      '  e: 8104,',
      '  f: 8105,',
      '  g: 8106,',
      '  h: 8107,',
      '  overwater: ',
      '};',
    ].join('\n');
    const offset = full.indexOf('overwater: ') + 'overwater: '.length;
    const r = suggestLocalCompletion(full, offset, 'typescript');
    assert.ok(r);
    assert.equal(r!.insert, '8108');
  });

  it('suggests closing paren for console.log(', () => {
    const full = 'console.log(';
    const r = suggestLocalCompletion(full, full.length, 'typescript');
    assert.ok(r);
    assert.equal(r!.insert, ')');
    assert.equal(r!.reason, 'js-log');
  });

  it('suggests bracket closer for open call', () => {
    const full = 'foo(bar[';
    const r = suggestLocalCompletion(full, full.length, 'typescript');
    assert.ok(r);
    assert.equal(r!.insert, '])');
    assert.equal(r!.reason, 'close-bracket');
  });
});
