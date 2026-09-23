/**
 * Fix with agent prompt builder (pure)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFixPromptFromParts,
  severityFromVsCodeNumber,
} from '../src/diagnostics/fixWithAgentPrompt';

describe('fixWithAgentPrompt', () => {
  it('maps vscode severity numbers', () => {
    assert.equal(severityFromVsCodeNumber(0), 'error');
    assert.equal(severityFromVsCodeNumber(1), 'warning');
  });

  it('includes diagnostic + nearby context', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}();`);
    const prompt = buildFixPromptFromParts(
      {
        relativePath: 'src/foo.ts',
        languageId: 'typescript',
        text: lines.join('\n'),
        lineCount: lines.length,
      },
      {
        message: "Cannot find name 'bar'",
        severity: 'error',
        startLine: 5,
        endLine: 5,
        source: 'ts',
        code: 2304,
      },
    );
    assert.match(prompt, /Fix this error/);
    assert.match(prompt, /src\/foo\.ts/);
    assert.match(prompt, /Cannot find name 'bar'/);
    assert.match(prompt, /Accept\/Reject/);
    assert.match(prompt, /MUST call tools/);
    assert.match(prompt, /COMPLETE corrected file contents/i);
    assert.match(prompt, /unique snippet/i);
    assert.match(prompt, /line5/);
    assert.match(prompt, /```typescript/);
    assert.match(prompt, /\[2304\]/);
  });
});
