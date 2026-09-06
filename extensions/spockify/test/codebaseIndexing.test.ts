/**
 * Codebase workspace path helpers + crawl progress.
 */
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { buildIndex, search } from '@spockify/codebase';
import type { CodebaseFs } from '@spockify/codebase';
import {
  normFsPath,
  relSegmentsUnderRoot,
} from '../src/codebase/pathUtils';

describe('workspaceFs path helpers', () => {
  it('normFsPath converts backslashes', () => {
    assert.equal(normFsPath('a\\b\\c'), 'a/b/c');
  });

  it('relSegmentsUnderRoot for nested remote-style paths', () => {
    const root = '/home/user/proj';
    assert.deepEqual(relSegmentsUnderRoot(root, root), []);
    assert.deepEqual(relSegmentsUnderRoot(root, `${root}/src/a.ts`), [
      'src',
      'a.ts',
    ]);
    assert.equal(relSegmentsUnderRoot(root, '/other/place'), null);
  });

  it('does not treat prefix-sibling as under root', () => {
    assert.equal(
      relSegmentsUnderRoot('/home/user/proj', '/home/user/proj-other/x'),
      null,
    );
  });
});

describe('buildIndex onProgress', () => {
  it('reports filesIndexed while crawling fixture', async () => {
    const fixture = path.join(
      __dirname,
      '../../../packages/spockify-codebase/test/fixtures/sample',
    );
    const nodeFs: CodebaseFs = {
      async readFile(p) {
        const { readFile } = await import('node:fs/promises');
        return readFile(p, 'utf8');
      },
      async readDir(p) {
        const { readdir } = await import('node:fs/promises');
        return readdir(p);
      },
      async stat(p) {
        const { stat } = await import('node:fs/promises');
        const st = await stat(p);
        return {
          isFile: st.isFile(),
          isDirectory: st.isDirectory(),
          size: st.size,
        };
      },
      async exists(p) {
        const { access } = await import('node:fs/promises');
        try {
          await access(p);
          return true;
        } catch {
          return false;
        }
      },
    };
    const seen: number[] = [];
    const index = await buildIndex(fixture, nodeFs, {
      onProgress: (info) => {
        seen.push(info.filesIndexed);
      },
    });
    assert.ok(index.chunks.length > 0);
    assert.ok(seen.length > 0);
    assert.equal(seen[seen.length - 1], seen.length);
    const hits = search(index, {
      query: 'xyzzy_spockify_fixture_marker_42',
      k: 3,
    });
    assert.ok(hits.length >= 1);
    assert.match(hits[0].path, /alpha\.ts|readme\.md/);
  });
});
