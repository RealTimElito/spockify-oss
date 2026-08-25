/**
 * Workspace path helpers + citation demangle (keep demangle in sync with chat.js).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Mirror of chat.js demangleFileCitations — strip path">path HTML residue. */
function demangleFileCitations(text: string): string {
  return String(text || '').replace(
    /([\w./@+-]+(?:\.\w+)?)">\1((?::\d+(?::\d+)?)?)/g,
    '$1$2',
  );
}

function normalizeWorkspaceRelPure(
  raw: string,
  rootFsPath = '/home/you/spockify',
): string | undefined {
  let clean = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean || clean === '.') return '';
  if (clean.startsWith('/') || /^[a-zA-Z]:\//.test(clean)) {
    const rootPath = rootFsPath.replace(/\\/g, '/');
    const abs = clean.replace(/\\/g, '/');
    if (abs === rootPath || abs.startsWith(rootPath + '/')) {
      clean = abs.slice(rootPath.length).replace(/^\//, '');
    } else {
      return undefined;
    }
  }
  const parts = clean.split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return undefined;
  return parts.join('/');
}

describe('demangleFileCitations', () => {
  it('strips path">path HTML residue', () => {
    assert.equal(
      demangleFileCitations('see safer/routes/cloud.py">safer/routes/cloud.py'),
      'see safer/routes/cloud.py',
    );
    assert.equal(
      demangleFileCitations('foo/bar.ts">foo/bar.ts:12'),
      'foo/bar.ts:12',
    );
  });

  it('leaves clean paths alone', () => {
    assert.equal(
      demangleFileCitations('safer/routes/cloud.py:10'),
      'safer/routes/cloud.py:10',
    );
  });
});

describe('normalizeWorkspaceRel (pure)', () => {
  it('keeps relative paths', () => {
    assert.equal(normalizeWorkspaceRelPure('src/a.ts'), 'src/a.ts');
    assert.equal(normalizeWorkspaceRelPure('./src/a.ts'), 'src/a.ts');
    assert.equal(normalizeWorkspaceRelPure(''), '');
    assert.equal(normalizeWorkspaceRelPure('.'), '');
  });

  it('strips workspace absolute prefix', () => {
    assert.equal(
      normalizeWorkspaceRelPure('/home/you/spockify/extensions/spockify/x.ts'),
      'extensions/spockify/x.ts',
    );
  });

  it('rejects escapes and outside roots', () => {
    assert.equal(normalizeWorkspaceRelPure('../secret'), undefined);
    assert.equal(normalizeWorkspaceRelPure('/etc/passwd'), undefined);
  });
});
