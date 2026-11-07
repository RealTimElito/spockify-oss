import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chunkFile } from '../src/chunker';

describe('chunkFile', () => {
  it('splits long files with overlap and 1-based lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const chunks = chunkFile('f.ts', content, { maxLines: 40, overlapLines: 10 });
    assert.ok(chunks.length >= 2);
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[0].endLine, 40);
    assert.equal(chunks[1].startLine, 31);
    assert.ok(chunks.every((c) => c.path === 'f.ts'));
  });

  it('returns empty for whitespace-only content', () => {
    assert.deepEqual(chunkFile('x', '   \n  \n'), []);
  });
});
