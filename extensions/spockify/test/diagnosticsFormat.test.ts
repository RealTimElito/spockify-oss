import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDiagnostics } from '../src/runtime/diagnosticsFormat';

describe('formatDiagnostics', () => {
  it('lists path, line, and severity and caps the rest', () => {
    const hits = [
      { path: 'src/a.ts', line: 4, severity: 'error' as const, message: 'missing name' },
      { path: 'src/b.ts', line: 9, severity: 'warning' as const, message: 'unused' },
      { path: 'src/c.ts', line: 1, severity: 'error' as const, message: 'extra' },
    ];
    const text = formatDiagnostics(hits, 2);
    assert.match(text, /src\/a\.ts:4 error: missing name/);
    assert.match(text, /src\/b\.ts:9 warning: unused/);
    assert.match(text, /…1 more/);
    assert.doesNotMatch(text, /src\/c\.ts/);
  });

  it('is empty when there are no hits', () => {
    assert.equal(formatDiagnostics([]), '');
  });
});
