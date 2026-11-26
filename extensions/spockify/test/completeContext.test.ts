/**
 * Tab-complete context heuristics
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCompleteContext,
  COMPLETE_PREFIX_BUDGET,
  COMPLETE_SUFFIX_BUDGET,
  computeDebounceHint,
  extractFileHead,
  normalizeInsertText,
  preferMultiline,
  resolveDebounceMs,
  shouldSkipCompletion,
  trimToBalanced,
} from '../src/complete/context';

describe('complete context', () => {
  it('skips mid-identifier', () => {
    const text = 'const fooBar = 1';
    const offset = text.indexOf('B'); // inside fooBar
    assert.equal(shouldSkipCompletion(text, offset, 'typescript'), true);
  });

  it('allows after punctuation', () => {
    const text = 'function f() {\n  ';
    assert.equal(
      shouldSkipCompletion(text, text.length, 'typescript'),
      false,
    );
  });

  it('prefers multi-line after brace', () => {
    assert.equal(preferMultiline('function f() {\n', 'typescript'), true);
    assert.equal(preferMultiline('{"a":', 'json'), false);
  });

  it('adaptive debounce: fast after newline, slow mid-ident', () => {
    assert.equal(computeDebounceHint('foo();\n', 'typescript'), 'fast');
    assert.equal(computeDebounceHint('const foo', 'typescript'), 'slow');
    assert.equal(resolveDebounceMs(30, 'fast', true), Math.max(20, Math.round(30 * 0.5)));
    assert.equal(
      resolveDebounceMs(30, 'slow', true),
      Math.min(80, Math.round(30 * 1.6)),
    );
    assert.equal(resolveDebounceMs(30, 'fast', false), 30);
  });

  it('normalize caps lines and strips fences', () => {
    const raw = '```ts\na\nb\nc\nd\ne\n```';
    const out = normalizeInsertText(raw, true, 3);
    assert.equal(out.split('\n').length <= 3, true);
    assert.ok(!out.includes('```'));
  });

  it('single-line policy takes first line only', () => {
    assert.equal(normalizeInsertText('one\ntwo', false, 12), 'one');
  });

  it('trimToBalanced drops trailing open block', () => {
    const text = 'if (x) {\n  a();\n  b(';
    const trimmed = trimToBalanced(text);
    assert.ok(trimmed.includes('a()'));
    assert.ok(!trimmed.includes('b(') || trimmed.endsWith('a();'));
  });

  it('buildCompleteContext uses 4k/1.2k FIM budgets', () => {
    const body = 'x'.repeat(COMPLETE_PREFIX_BUDGET + 500);
    const full = `import { foo } from './foo';\n\n${body}|tail`;
    const offset = full.indexOf('|');
    const ctx = buildCompleteContext(full.replace('|', ''), offset, 'typescript', {
      openTabs: ['a.ts', 'b.ts'],
    });
    assert.equal(ctx.prefix.length, COMPLETE_PREFIX_BUDGET);
    assert.ok(ctx.suffix.length <= COMPLETE_SUFFIX_BUDGET);
    assert.ok(ctx.context.includes('FILE_HEAD:'));
    assert.ok(ctx.context.includes('import { foo }'));
    assert.ok(ctx.context.includes('OPEN_TABS: a.ts, b.ts'));
  });

  it('extractFileHead empty when prefix covers file start', () => {
    const full = 'import a from "a";\nconst x = 1;\n';
    assert.equal(
      extractFileHead(full, full.length, COMPLETE_PREFIX_BUDGET, 900),
      '',
    );
  });
});
