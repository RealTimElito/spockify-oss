/**
 * Deterministic local E501 wrap + resolveNonDestructiveNext splice.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLocalDiagnosticFix,
  isLineTooLongDiagnostic,
  maxLenFromDiagnostic,
  wrapLongLine,
} from '../src/diagnostics/localDiagnosticFixes';
import {
  isDestructiveFullReplace,
  isMidFileSuffixWipe,
  resolveNonDestructiveNext,
  trySnippetReplace,
} from '../src/composer/patchSanity';
import { buildFixPromptFromParts } from '../src/diagnostics/fixWithAgentPrompt';
import { spliceLineRange } from '../src/composer/parsePatches';

const LONG =
  '    payload = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"';

function sampleFile(): string {
  return [
    '#!/usr/bin/env python3',
    '"""continuous training helper."""',
    '',
    'import os',
    'import sys',
    '',
    'def main():',
    '    print("start")',
    LONG,
    '    print("done")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n');
}

const WRAP_SNIPPET = [
  '    payload = (',
  '        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
  '    )',
].join('\n');

describe('localDiagnosticFixes E501', () => {
  it('detects E501 / line too long', () => {
    assert.equal(
      isLineTooLongDiagnostic({
        message: 'line too long (88 > 79 characters)',
        code: 'E501',
        startLine: 0,
        endLine: 0,
      }),
      true,
    );
    assert.equal(maxLenFromDiagnostic({
      message: 'line too long (88 > 79 characters)',
      startLine: 0,
      endLine: 0,
    }), 79);
  });

  it('wraps a long assignment line', () => {
    const wrapped = wrapLongLine(LONG, 79);
    assert.ok(wrapped);
    assert.ok(wrapped!.includes('payload = ('));
    assert.ok(wrapped!.includes('xxxxxxxx'));
    assert.ok(!wrapped!.split('\n').some((l) => l === LONG));
  });

  it('applies local fix into full file without wiping', () => {
    const current = sampleFile();
    const next = applyLocalDiagnosticFix(current, {
      message: 'line too long (88 > 79 characters)',
      code: 'E501',
      source: 'Flake8',
      startLine: 8,
      endLine: 8,
    });
    assert.ok(next);
    assert.equal(isDestructiveFullReplace(current, next!), false);
    assert.ok(next!.includes('payload = ('));
    assert.ok(next!.includes('print("start")'));
    assert.ok(next!.includes('if __name__'));
  });
});

describe('resolveNonDestructiveNext', () => {
  it('splices wrap snippet instead of refusing', () => {
    const current = sampleFile();
    assert.equal(isDestructiveFullReplace(current, WRAP_SNIPPET), true);
    const resolved = resolveNonDestructiveNext(current, WRAP_SNIPPET);
    assert.ok(resolved);
    assert.equal(resolved!.via, 'snippet');
    assert.ok(resolved!.next.includes('print("done")'));
    assert.ok(resolved!.next.includes('payload = ('));
  });

  it('accepts a real full-file wrap', () => {
    const current = sampleFile();
    const next = trySnippetReplace(current, WRAP_SNIPPET)!;
    const resolved = resolveNonDestructiveNext(current, next);
    assert.ok(resolved);
    assert.equal(resolved!.via, 'full');
  });

  it('refuses unrelated wipe with no splice target', () => {
    const current = sampleFile();
    assert.equal(
      resolveNonDestructiveNext(current, 'totally_different = 1'),
      undefined,
    );
  });

  it('recovers truncated prefix+wrap without wiping suffix', () => {
    const current = sampleFile();
    const lines = current.split('\n');
    const truncated = [...lines.slice(0, 8), ...WRAP_SNIPPET.split('\n')].join(
      '\n',
    );
    assert.equal(isMidFileSuffixWipe(current, truncated), true);
    assert.equal(isDestructiveFullReplace(current, truncated), true);
    const resolved = resolveNonDestructiveNext(current, truncated);
    assert.ok(resolved);
    assert.equal(resolved!.via, 'snippet');
    assert.ok(resolved!.next.includes('print("done")'));
    assert.ok(resolved!.next.includes('if __name__'));
    assert.ok(resolved!.next.includes('payload = ('));
    assert.ok(!resolved!.next.split('\n').includes(LONG));
    // Tiny hunk: suffix lines preserved verbatim
    assert.ok(resolved!.next.includes('    print("done")'));
  });
});

describe('spliceLineRange caps oversized cites', () => {
  it('does not wipe from mid-file to EOF when endLine is huge', () => {
    const current = sampleFile();
    const next = spliceLineRange(current, 9, 9999, WRAP_SNIPPET);
    assert.ok(next.includes('print("done")'));
    assert.ok(next.includes('if __name__'));
    assert.ok(next.includes('payload = ('));
    assert.equal(isDestructiveFullReplace(current, next), false);
  });
});

describe('FixWithAgentPrompt softened gates', () => {
  it('asks for tools + allows unique snippet splice', () => {
    const prompt = buildFixPromptFromParts(
      {
        relativePath: 'safer/scripts/continuous_training.py',
        languageId: 'python',
        text: sampleFile(),
        lineCount: sampleFile().split('\n').length,
      },
      {
        message: 'line too long (E501)',
        severity: 'error',
        startLine: 8,
        endLine: 8,
        source: 'Flake8',
        code: 'E501',
      },
    );
    assert.match(prompt, /MUST call tools/i);
    assert.match(prompt, /unique snippet/i);
    assert.match(prompt, /read_file/);
    assert.match(prompt, /E501/);
    assert.match(prompt, /end-of-file|truncate/i);
  });
});
