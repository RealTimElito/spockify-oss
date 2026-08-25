/**
 * Regression: chat/agent patch staging must not wipe a file into
 * "delete everything + one long line" for small E501-style wraps.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyUnifiedDiffBody,
  parseAssistantUnifiedDiffFiles,
} from '../src/composer/assistantProseDiffs';
import { parseChatFencePatches } from '../src/composer/parsePatches';
import {
  isDestructiveFullReplace,
  isMidFileSuffixWipe,
  retainedLineRatio,
  resolveNonDestructiveNext,
  trySnippetReplace,
} from '../src/composer/patchSanity';
import { applyHunksToContent, parseHunksFromUnifiedDiff } from '../src/apply/hunks';
import { buildFixPromptFromParts } from '../src/diagnostics/fixWithAgentPrompt';

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

const GOOD_DIFF = [
  '```diff',
  '--- a/safer/scripts/continuous_training.py',
  '+++ b/safer/scripts/continuous_training.py',
  '@@ -9,1 +9,3 @@',
  `-${LONG}`,
  '+    payload = (',
  '+        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
  '+    )',
  '```',
].join('\n');

describe('patchSanity destructive wipe detection', () => {
  it('flags delete-all + one long line as destructive', () => {
    const current = sampleFile();
    assert.equal(isDestructiveFullReplace(current, LONG), true);
    assert.equal(isDestructiveFullReplace(current, WRAP_SNIPPET), true);
    assert.ok(retainedLineRatio(current, LONG) < 0.5);
  });

  it('allows a real wrap that keeps most lines', () => {
    const current = sampleFile();
    const next = trySnippetReplace(current, WRAP_SNIPPET);
    assert.ok(next);
    assert.equal(isDestructiveFullReplace(current, next!), false);
    assert.ok(next!.includes('payload = ('));
    assert.ok(next!.includes('print("start")'));
    assert.ok(next!.includes('if __name__'));
    assert.ok(!next!.split('\n').includes(LONG));
  });

  it('refuses full replace when snippet locate fails', () => {
    const current = sampleFile();
    const unrelated = 'totally_different = 1';
    assert.equal(trySnippetReplace(current, unrelated), undefined);
    assert.equal(isDestructiveFullReplace(current, unrelated), true);
  });

  it('flags truncated prefix+edit as mid-file suffix wipe', () => {
    const current = sampleFile();
    const lines = current.split('\n');
    const truncated = [...lines.slice(0, 8), ...WRAP_SNIPPET.split('\n')].join(
      '\n',
    );
    assert.equal(isMidFileSuffixWipe(current, truncated), true);
    const resolved = resolveNonDestructiveNext(current, truncated);
    assert.ok(resolved);
    assert.ok(resolved!.next.includes('print("done")'));
    assert.ok(resolved!.next.includes('main()'));
  });
});

describe('unified diff E501 wrap apply', () => {
  it('applies small wrap hunk without wiping the file', () => {
    const current = sampleFile();
    const files = parseAssistantUnifiedDiffFiles(
      `Here is the fix:\n\n${GOOD_DIFF}\n`,
    );
    assert.equal(files.length, 1);
    const next = applyUnifiedDiffBody(
      files[0].path,
      current,
      files[0].unifiedDiff!,
    );
    assert.notEqual(next, current);
    assert.equal(isDestructiveFullReplace(current, next), false);
    assert.ok(next.includes('payload = ('));
    assert.ok(next.includes('print("done")'));
    assert.equal(next.split('\n').length >= current.split('\n').length, true);
  });

  it('locateHunkStart recovers when @@ line is slightly wrong', () => {
    const current = sampleFile();
    // Wrong oldStart (claims line 1) but body matches the real long line.
    const badHeaderDiff = [
      '--- a/foo.py',
      '+++ b/foo.py',
      '@@ -1,1 +1,3 @@',
      `-${LONG}`,
      '+    payload = (',
      '+        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
      '+    )',
    ].join('\n');
    const hunks = parseHunksFromUnifiedDiff('foo.py', badHeaderDiff);
    const next = applyHunksToContent(current, hunks, undefined);
    assert.ok(next.includes('payload = ('));
    assert.ok(next.includes('#!/usr/bin/env python3'));
    assert.equal(isDestructiveFullReplace(current, next), false);
  });

  it('skips hunk when old context is absent (no wipe)', () => {
    const current = sampleFile();
    const ghost = [
      '--- a/foo.py',
      '+++ b/foo.py',
      '@@ -1,3 +1,1 @@',
      '-nope1',
      '-nope2',
      '-nope3',
      '+only',
    ].join('\n');
    const hunks = parseHunksFromUnifiedDiff('foo.py', ghost);
    const next = applyHunksToContent(current, hunks, undefined);
    assert.equal(next, current);
  });
});

describe('parseChatFencePatches ignores diff fences', () => {
  it('does not treat cite + ```diff as full-file content', () => {
    const text = [
      'Update `safer/scripts/continuous_training.py`:',
      '',
      GOOD_DIFF,
    ].join('\n');
    const fences = parseChatFencePatches(text);
    assert.equal(fences.length, 0);
  });

  it('still parses path-tagged python fences', () => {
    const text = [
      '```python safer/scripts/continuous_training.py',
      WRAP_SNIPPET,
      '```',
    ].join('\n');
    const fences = parseChatFencePatches(text);
    assert.equal(fences.length, 1);
    assert.equal(fences[0].path, 'safer/scripts/continuous_training.py');
    assert.equal(fences[0].content, WRAP_SNIPPET);
  });
});

describe('fence snippet vs unified diff preference (pure)', () => {
  it('snippet-as-content wipe is detected; diff apply is the safe path', () => {
    const current = sampleFile();
    // What 0.8.36 materialize did on failed locate: stage snippet as nextContent.
    const wiped = WRAP_SNIPPET;
    assert.equal(isDestructiveFullReplace(current, wiped), true);

    const files = parseAssistantUnifiedDiffFiles(GOOD_DIFF);
    const fixed = applyUnifiedDiffBody(
      files[0].path,
      current,
      files[0].unifiedDiff!,
    );
    assert.equal(isDestructiveFullReplace(current, fixed), false);
    // Prefer diff result over fence wipe for the same logical fix.
    assert.ok(fixed.split('\n').length > wiped.split('\n').length);
  });
});

describe('FixWithAgentPrompt completeness', () => {
  it('requires tools and minimal line-range fix', () => {
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
    assert.match(prompt, /COMPLETE corrected file contents/i);
    assert.match(prompt, /unique snippet/i);
    assert.match(prompt, /reported line range/i);
    assert.match(prompt, /E501/);
  });
});
