/**
 * Prose unified-diff staging helpers (Fix with agent safety net).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyUnifiedDiffBody,
  isFileEditToolName,
  looksLikeUnifiedDiff,
  messagesFileEditToolsSucceeded,
  messagesUsedFileEditTools,
  parseAssistantUnifiedDiffFiles,
} from '../src/composer/assistantProseDiffs';
import { buildFixPromptFromParts } from '../src/diagnostics/fixWithAgentPrompt';

describe('assistantProseDiffs', () => {
  it('detects --- a/ / +++ b/ and diff --git', () => {
    assert.equal(
      looksLikeUnifiedDiff(
        '--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-a\n+b\n',
      ),
      true,
    );
    assert.equal(
      looksLikeUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n'),
      true,
    );
    assert.equal(looksLikeUnifiedDiff('just ---\nand +++ nowhere'), false);
    assert.equal(looksLikeUnifiedDiff('plain explanation'), false);
  });

  it('parses markdown prose unified diff', () => {
    const text = [
      'Here is the wrap fix:',
      '',
      '```diff',
      '--- a/safer/scripts/continuous_training.py',
      '+++ b/safer/scripts/continuous_training.py',
      '@@ -10,2 +10,3 @@',
      ' keep',
      '-too_long = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
      '+too_long = (',
      '+    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
      '+)',
      '```',
      '',
      'Retry if needed.',
    ].join('\n');
    const files = parseAssistantUnifiedDiffFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'safer/scripts/continuous_training.py');
    assert.match(files[0].unifiedDiff ?? '', /too_long/);
  });

  it('parses bare --- a/ without fences', () => {
    const text = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-old',
      '+new',
    ].join('\n');
    const files = parseAssistantUnifiedDiffFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'src/a.ts');
    const next = applyUnifiedDiffBody(
      'src/a.ts',
      'line1\nold\n',
      files[0].unifiedDiff!,
    );
    assert.equal(next, 'line1\nnew\n');
  });

  it('detects file-edit tools in message transcript', () => {
    assert.equal(isFileEditToolName('apply_patch'), true);
    assert.equal(isFileEditToolName('write_file'), true);
    assert.equal(isFileEditToolName('read_file'), false);
    assert.equal(
      messagesUsedFileEditTools([
        { role: 'user' },
        {
          role: 'assistant',
          toolCalls: [{ name: 'apply_patch' }],
        },
      ]),
      true,
    );
    assert.equal(
      messagesUsedFileEditTools([
        { role: 'user' },
        { role: 'assistant' },
      ]),
      false,
    );
  });

  it('detects successful vs refused edit tool results', () => {
    assert.equal(
      messagesFileEditToolsSucceeded([
        { role: 'tool', name: 'apply_patch', content: 'Error: refused destructive' },
      ]),
      false,
    );
    assert.equal(
      messagesFileEditToolsSucceeded([
        {
          role: 'tool',
          name: 'apply_patch',
          content: JSON.stringify({ staged: ['a.py'], message: 'File edits staged' }),
        },
      ]),
      true,
    );
  });
});

describe('FixWithAgentPrompt tools requirement', () => {
  it('requires apply_patch or write_file via tools', () => {
    const prompt = buildFixPromptFromParts(
      {
        relativePath: 'safer/scripts/continuous_training.py',
        languageId: 'python',
        text: 'x = 1\n',
        lineCount: 1,
      },
      {
        message: 'line too long (E501)',
        severity: 'error',
        startLine: 0,
        endLine: 0,
        source: 'Flake8',
        code: 'E501',
      },
    );
    assert.match(prompt, /MUST call tools/);
    assert.match(prompt, /apply_patch/);
    assert.match(prompt, /COMPLETE corrected file contents/i);
    assert.match(prompt, /unique snippet/i);
    assert.match(prompt, /safer\/scripts\/continuous_training\.py/);
    assert.match(prompt, /E501/);
    assert.match(prompt, /Flake8/);
  });
});
