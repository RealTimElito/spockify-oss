/**
 * File citation parsing helpers mirrored from chat.js (keep in sync).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function parseFileRef(raw: string): {
  path: string;
  line?: number;
  endLine?: number;
  col?: number;
} | null {
  const t = String(raw || '').trim();
  if (!t || /\s/.test(t) || t.length > 260) return null;
  if (/^(https?:|file:|mailto:)/i.test(t)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null;
  // Cursor-style startLine:endLine:path (path may contain colons rarely).
  const cursorRange = /^(\d+):(\d+):(.+)$/.exec(t);
  if (cursorRange) {
    const pathPart = cursorRange[3];
    const line = Number(cursorRange[1]);
    const endLine = Number(cursorRange[2]);
    if (
      /[\\/]/.test(pathPart) ||
      /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|md|json|ya?ml|toml|css|scss|html|vue|svelte|sh|bash|zsh|c|cc|cpp|h|hpp|cs|rb|php|sql|proto|graphql|xml|txt|env|dockerfile)$/i.test(
        pathPart,
      )
    ) {
      return {
        path: pathPart,
        line: Math.min(line, endLine),
        endLine: Math.max(line, endLine),
        col: undefined,
      };
    }
  }
  let pathPart = t;
  let line: number | undefined;
  let endLine: number | undefined;
  let col: number | undefined;
  const range = /^(.+?):(\d+)-(\d+)$/.exec(t);
  const withCol = /^(.+?):(\d+):(\d+)$/.exec(t);
  const withLine = /^(.+?):(\d+)$/.exec(t);
  if (range) {
    pathPart = range[1];
    line = Number(range[2]);
    endLine = Number(range[3]);
  } else if (withCol) {
    pathPart = withCol[1];
    line = Number(withCol[2]);
    col = Number(withCol[3]);
  } else if (withLine) {
    pathPart = withLine[1];
    line = Number(withLine[2]);
  }
  if (
    !/[\\/]/.test(pathPart) &&
    !/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|md|json|ya?ml|toml|css|scss|html|vue|svelte|sh|bash|zsh|c|cc|cpp|h|hpp|cs|rb|php|sql|proto|graphql|xml|txt|env|dockerfile)$/i.test(
      pathPart,
    )
  ) {
    return null;
  }
  if (pathPart.startsWith('-') || pathPart === '.' || pathPart === '..') {
    return null;
  }
  if (endLine != null && line != null && endLine < line) {
    const tmp = line;
    line = endLine;
    endLine = tmp;
  }
  return { path: pathPart, line, endLine, col };
}

describe('parseFileRef (chat file links)', () => {
  it('parses path:line citations', () => {
    assert.deepEqual(parseFileRef('src/foo.ts:42'), {
      path: 'src/foo.ts',
      line: 42,
      endLine: undefined,
      col: undefined,
    });
    assert.deepEqual(parseFileRef('extensions/spockify/src/a.ts:10:3'), {
      path: 'extensions/spockify/src/a.ts',
      line: 10,
      endLine: undefined,
      col: 3,
    });
  });

  it('parses path:start-end ranges', () => {
    assert.deepEqual(parseFileRef('safer/train.py:365-424'), {
      path: 'safer/train.py',
      line: 365,
      endLine: 424,
      col: undefined,
    });
  });

  it('parses Cursor start:end:path fences', () => {
    assert.deepEqual(parseFileRef('365:424:safer/train.py'), {
      path: 'safer/train.py',
      line: 365,
      endLine: 424,
      col: undefined,
    });
  });

  it('accepts extension-only basename', () => {
    assert.equal(parseFileRef('readme.md')?.path, 'readme.md');
  });

  it('parses basename:line and basename:start-end', () => {
    assert.deepEqual(parseFileRef('host.js:123'), {
      path: 'host.js',
      line: 123,
      endLine: undefined,
      col: undefined,
    });
    assert.deepEqual(parseFileRef('host.js:10-20'), {
      path: 'host.js',
      line: 10,
      endLine: 20,
      col: undefined,
    });
  });

  it('rejects urls and bare words', () => {
    assert.equal(parseFileRef('https://spockify.eu/x'), null);
    assert.equal(parseFileRef('hello'), null);
  });
});
