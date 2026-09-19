/**
 * File-card citation helpers mirrored from chat.js (keep in sync).
 * Covers prose-before-fence detection that drives Cursor-style cards.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const FILE_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|md|json|ya?ml|toml|css|scss|html|vue|svelte|sh|bash|zsh|c|cc|cpp|h|hpp|cs|rb|php|sql|proto|graphql|xml|txt|env|dockerfile)$/i;

const FILE_PATH_TOKEN = '(?:\\.?\\/)?(?:[\\w.@-]+\\/)*[\\w.@-]+\\.\\w+';

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
  const cursorRange = /^(\d+):(\d+):(.+)$/.exec(t);
  if (cursorRange) {
    const pathPart = cursorRange[3];
    const line = Number(cursorRange[1]);
    const endLine = Number(cursorRange[2]);
    if (/[\\/]/.test(pathPart) || FILE_EXT_RE.test(pathPart)) {
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
  if (!/[\\/]/.test(pathPart) && !FILE_EXT_RE.test(pathPart)) {
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

function extractNearbyLineRange(
  text: string,
): { startLine: number; endLine: number } | null {
  const s = String(text || '');
  const m =
    /\blines?\s+(\d+)\s*[-–—]\s*(\d+)\b|\bline\s+(\d+)\b|\bL(\d+)(?:\s*[-–—]\s*L?(\d+))?\b/i.exec(
      s,
    );
  if (!m) return null;
  if (m[1]) {
    return {
      startLine: Math.min(Number(m[1]), Number(m[2])),
      endLine: Math.max(Number(m[1]), Number(m[2])),
    };
  }
  if (m[3]) {
    return { startLine: Number(m[3]), endLine: Number(m[3]) };
  }
  const a = Number(m[4]);
  const b = m[5] ? Number(m[5]) : a;
  return { startLine: Math.min(a, b), endLine: Math.max(a, b) };
}

function extractCiteBeforeFence(before: string): {
  path: string;
  startLine?: number;
  endLine?: number;
  matchStart: number;
} | null {
  const chunk = String(before || '');
  const trimmed = chunk.replace(/\s+$/, '');
  if (!trimmed) return null;
  const tail = trimmed.slice(Math.max(0, trimmed.length - 500));
  const baseOffset = trimmed.length - tail.length;

  function citeResult(
    path: string,
    startLine: number | undefined,
    endLine: number | undefined,
    matchIndex: number,
  ) {
    const ref = parseFileRef(path);
    if (!ref) return null;
    let start = startLine != null ? startLine : ref.line;
    let end =
      endLine != null ? endLine : ref.endLine != null ? ref.endLine : start;
    if (start == null) {
      const nearby = extractNearbyLineRange(
        tail.slice(Math.max(0, matchIndex)),
      );
      if (nearby) {
        start = nearby.startLine;
        end = nearby.endLine;
      }
    }
    return {
      path: ref.path,
      startLine: start,
      endLine: end != null ? end : start,
      matchStart: baseOffset + matchIndex,
    };
  }

  const cursorAtEnd =
    /`?(\d+:\d+:(?:\.\/)?(?:[\w.@-]+\/)*[\w.@-]+\.\w+)`?\s*[:.]?\s*$/.exec(
      tail,
    );
  if (cursorAtEnd) {
    const ref = parseFileRef(cursorAtEnd[1]);
    if (ref && ref.line != null) {
      return {
        path: ref.path,
        startLine: ref.line,
        endLine: ref.endLine != null ? ref.endLine : ref.line,
        matchStart: baseOffset + cursorAtEnd.index,
      };
    }
  }

  const btRe = new RegExp(
    '`(' +
      FILE_PATH_TOKEN +
      '(?::\\d+(?:-\\d+)?)?)`(?:[^`\\n]*(?:\\blines?\\s+(\\d+)\\s*[-–—]\\s*(\\d+)|\\bline\\s+(\\d+)))?[^\\n]*$',
    'i',
  );
  const bt = btRe.exec(tail);
  if (bt) {
    const start = bt[2] ? Number(bt[2]) : bt[4] ? Number(bt[4]) : undefined;
    const end = bt[3] ? Number(bt[3]) : start;
    const hit = citeResult(bt[1], start, end, bt.index);
    if (hit) return hit;
  }

  const bareRe = new RegExp(
    '(' +
      FILE_PATH_TOKEN +
      ')(?::(\\d+)(?:-(\\d+))?)?(?:[^\\S\\n]*lines?\\s+(\\d+)\\s*[-–—]\\s*(\\d+))?\\s*[:.]?\\s*$',
    'i',
  );
  const bare = bareRe.exec(tail);
  if (bare) {
    const start = bare[2]
      ? Number(bare[2])
      : bare[4]
        ? Number(bare[4])
        : undefined;
    const end = bare[3]
      ? Number(bare[3])
      : bare[5]
        ? Number(bare[5])
        : start;
    const hit = citeResult(bare[1], start, end, bare.index);
    if (hit) return hit;
  }

  const lastLines = tail.split(/\n/).slice(-3).join('\n');
  const pathInTail = new RegExp(
    '`?(' + FILE_PATH_TOKEN + '(?::\\d+(?:-\\d+)?)?)`?',
    'g',
  );
  let pm: RegExpExecArray | null;
  let lastPath: {
    ref: NonNullable<ReturnType<typeof parseFileRef>>;
    indexInLast: number;
  } | null = null;
  while ((pm = pathInTail.exec(lastLines)) !== null) {
    const ref = parseFileRef(pm[1]);
    if (ref) {
      lastPath = { ref, indexInLast: pm.index };
    }
  }
  if (lastPath) {
    const nearby =
      lastPath.ref.line != null
        ? {
            startLine: lastPath.ref.line,
            endLine:
              lastPath.ref.endLine != null
                ? lastPath.ref.endLine
                : lastPath.ref.line,
          }
        : extractNearbyLineRange(lastLines);
    const idxInTail = tail.lastIndexOf(lastLines);
    return {
      path: lastPath.ref.path,
      startLine: nearby ? nearby.startLine : undefined,
      endLine: nearby ? nearby.endLine : undefined,
      matchStart:
        baseOffset + (idxInTail >= 0 ? idxInTail : 0) + lastPath.indexInLast,
    };
  }
  return null;
}

function parseFencePath(hint: string): string {
  const toks = hint.split(/\s+/).filter(Boolean);
  const pathTok = toks.length ? toks[toks.length - 1] : '';
  const lang = (toks[0] || '').toLowerCase();
  const isShell =
    /^(bash|sh|shell|zsh|fish|powershell|pwsh|console|terminal|cmd|bat)$/.test(
      lang,
    );
  if (isShell) return '';
  const pathLike =
    hint.includes('/') ||
    /^(\d+:)+\S+\.\w+/.test(pathTok) ||
    /\.[a-z0-9]+$/i.test(pathTok);
  if (pathLike && parseFileRef(pathTok)) return pathTok;
  if (parseFileRef(hint)) return hint;
  for (let ti = toks.length - 1; ti >= 0; ti--) {
    if (parseFileRef(toks[ti])) return toks[ti];
  }
  return '';
}

describe('extractCiteBeforeFence (file cards)', () => {
  it('matches path + lines before fence despite trailing blank lines', () => {
    const cite = extractCiteBeforeFence(
      'See safer/train.py lines 365-424:\n\n',
    );
    assert.ok(cite);
    assert.equal(cite!.path, 'safer/train.py');
    assert.equal(cite!.startLine, 365);
    assert.equal(cite!.endLine, 424);
  });

  it('matches backtick path without lines (path-only card)', () => {
    const cite = extractCiteBeforeFence(
      'Defined in `src/api/host.js`:\n\n',
    );
    assert.ok(cite);
    assert.equal(cite!.path, 'src/api/host.js');
    assert.equal(cite!.startLine, undefined);
  });

  it('matches basename path:line', () => {
    const cite = extractCiteBeforeFence('See host.js:42\n');
    assert.ok(cite);
    assert.equal(cite!.path, 'host.js');
    assert.equal(cite!.startLine, 42);
  });

  it('matches in `path` + nearby line numbers', () => {
    const cite = extractCiteBeforeFence(
      'Look in `safer/foo.js` around lines 10-20:\n\n',
    );
    assert.ok(cite);
    assert.equal(cite!.path, 'safer/foo.js');
    assert.equal(cite!.startLine, 10);
    assert.equal(cite!.endLine, 20);
  });

  it('matches Cursor start:end:path before fence', () => {
    const cite = extractCiteBeforeFence('42:50:src/getApiHost.ts\n\n');
    assert.ok(cite);
    assert.equal(cite!.path, 'src/getApiHost.ts');
    assert.equal(cite!.startLine, 42);
    assert.equal(cite!.endLine, 50);
  });

  it('returns null when no path is present', () => {
    assert.equal(extractCiteBeforeFence('Here is the function:\n\n'), null);
  });
});

describe('fence info-string path detection', () => {
  it('parses ```javascript path/to/file.js', () => {
    assert.equal(parseFencePath('javascript src/api/host.js'), 'src/api/host.js');
  });

  it('parses ```start:end:path', () => {
    assert.equal(parseFencePath('10:20:src/api/host.js'), '10:20:src/api/host.js');
    const ref = parseFileRef('10:20:src/api/host.js');
    assert.equal(ref?.path, 'src/api/host.js');
    assert.equal(ref?.line, 10);
    assert.equal(ref?.endLine, 20);
  });

  it('parses path:line on fence hint', () => {
    assert.equal(parseFencePath('js host.js:10-20'), 'host.js:10-20');
  });

  it('ignores shell fences', () => {
    assert.equal(parseFencePath('bash scripts/run.sh'), '');
  });
});

describe('parseFileRef extras', () => {
  it('parses markdown-style path#L hashes via path only', () => {
    assert.deepEqual(parseFileRef('src/foo.ts:12-40'), {
      path: 'src/foo.ts',
      line: 12,
      endLine: 40,
      col: undefined,
    });
  });
});

/**
 * Promote path:line to block cards only on own line / after sentence
 * (mirrors chat.js extractBlockFileCite — keep in sync).
 */
function extractBlockFileCite(line: string): {
  prose: string;
  path: string;
  startLine?: number;
  endLine?: number;
} | null {
  const t = String(line || '').trim();
  if (!t) return null;

  const cursorOwn =
    /^`?(\d+:\d+:(?:\.\/)?(?:[\w.@-]+\/)*[\w.@-]+\.\w+)`?\s*[.:]?\s*$/.exec(t);
  if (cursorOwn) {
    const ref = parseFileRef(cursorOwn[1]);
    if (ref && ref.line != null) {
      return {
        prose: '',
        path: ref.path,
        startLine: ref.line,
        endLine: ref.endLine != null ? ref.endLine : ref.line,
      };
    }
  }

  const ownRe = new RegExp(
    '^`?(' + FILE_PATH_TOKEN + '(?::\\d+(?:-\\d+)?)?)`?\\s*[.:]?\\s*$',
  );
  const own = ownRe.exec(t);
  if (own) {
    const ref = parseFileRef(own[1]);
    if (ref) {
      return {
        prose: '',
        path: ref.path,
        startLine: ref.line,
        endLine: ref.endLine != null ? ref.endLine : ref.line,
      };
    }
  }

  const afterRe = new RegExp(
    '^([\\s\\S]*[.!?])\\s+`?(' +
      FILE_PATH_TOKEN +
      '(?::\\d+(?:-\\d+)?)?)`?\\s*$',
  );
  const after = afterRe.exec(t);
  if (after) {
    const ref = parseFileRef(after[2]);
    if (ref && ref.line != null) {
      return {
        prose: after[1],
        path: ref.path,
        startLine: ref.line,
        endLine: ref.endLine != null ? ref.endLine : ref.line,
      };
    }
  }
  return null;
}

describe('extractBlockFileCite (inline link vs block card)', () => {
  it('promotes own-line path:range to a card', () => {
    const hit = extractBlockFileCite('`continuous_training.py:157-202`');
    assert.ok(hit);
    assert.equal(hit!.prose, '');
    assert.equal(hit!.path, 'continuous_training.py');
    assert.equal(hit!.startLine, 157);
    assert.equal(hit!.endLine, 202);
  });

  it('promotes cite after a finished sentence', () => {
    const hit = extractBlockFileCite(
      'Defined here. safer/scripts/continuous_training.py:157-202',
    );
    assert.ok(hit);
    assert.equal(hit!.prose, 'Defined here.');
    assert.equal(hit!.path, 'safer/scripts/continuous_training.py');
    assert.equal(hit!.startLine, 157);
  });

  it('does not promote mid-sentence cites (stay links)', () => {
    assert.equal(
      extractBlockFileCite(
        'as seen in `continuous_training.py:157-202` the actual mapping',
      ),
      null,
    );
    assert.equal(
      extractBlockFileCite(
        'as seen in continuous_training.py:157-202 the actual mapping',
      ),
      null,
    );
  });

  it('promotes Cursor start:end:path on its own line', () => {
    const hit = extractBlockFileCite('157:202:safer/scripts/continuous_training.py');
    assert.ok(hit);
    assert.equal(hit!.path, 'safer/scripts/continuous_training.py');
    assert.equal(hit!.startLine, 157);
    assert.equal(hit!.endLine, 202);
  });
});
