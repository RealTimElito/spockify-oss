import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { toolArgsSummary } from '../src/composer/toolSummary';

describe('toolArgsSummary', () => {
  it('summarizes apply_patch paths', () => {
    const s = toolArgsSummary('apply_patch', {
      files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
    });
    assert.equal(s, 'src/a.ts, src/b.ts');
  });

  it('summarizes terminal_run command', () => {
    const s = toolArgsSummary('terminal_run', { command: 'npm test' });
    assert.equal(s, 'npm test');
  });

  it('summarizes grep and glob explore tools', () => {
    assert.equal(
      toolArgsSummary('grep', { pattern: 'showTimestamp' }),
      'showTimestamp',
    );
    assert.equal(
      toolArgsSummary('glob_file_search', { glob: '**/*cloud*.py' }),
      '**/*cloud*.py',
    );
    assert.equal(toolArgsSummary('list_dir', { path: 'src' }), 'src');
  });
});
