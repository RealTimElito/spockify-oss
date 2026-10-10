import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = join(root, 'dist/apply');

const parse = await import(join(dist, 'parse.js'));
const diff = await import(join(dist, 'diff.js'));
const hunks = await import(join(dist, 'hunks.js'));

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('parse fenced multi-file blocks', () => {
  const text = readFileSync(join(fixtures, 'fenced-multi.txt'), 'utf8');
  const req = parse.parsePatchText(text, 'composer');
  assert.equal(req.files.length, 2);
  assert.equal(req.files[0].path, 'src/a.ts');
  assert.match(req.files[0].nextContent ?? '', /line2-new/);
  assert.equal(req.files[1].path, 'src/b.ts');
});

test('parse unified diff file', () => {
  const text = readFileSync(join(fixtures, 'sample.patch'), 'utf8');
  const files = parse.parseUnifiedDiffText(text);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'src/foo.ts');
  assert.match(files[0].unifiedDiff ?? '', /^---/m);
});

test('build unified diff from contents', () => {
  const oldC = 'alpha\nbeta\ndelta\n';
  const newC = 'alpha\nbeta\ngamma\ndelta\n';
  const u = diff.buildUnifiedDiff('src/foo.ts', oldC, newC);
  assert.match(u, /\+gamma/);
  assert.match(u, /^--- a\/src\/foo.ts/m);
});

test('mid-file insert does not wipe the file in unified diff', () => {
  const head = Array.from({ length: 30 }, (_, i) => `h${i}`).join('\n');
  const tail = Array.from({ length: 30 }, (_, i) => `t${i}`).join('\n');
  const oldC = `${head}\n${tail}\n`;
  const newC = `${head}\ninserted-a\ninserted-b\n${tail}\n`;
  const u = diff.buildUnifiedDiff('big.ts', oldC, newC);
  const dels = (u.match(/^-/gm) || []).filter((l) => !l.startsWith('---'));
  assert.ok(
    dels.length <= 3,
    `expected surgical diff, got ${dels.length} deletions:\n${u}`,
  );
  assert.match(u, /\+inserted-a/);
});


test('apply single hunk accept', () => {
  const oldC = 'alpha\nbeta\ndelta\n';
  const patch = readFileSync(join(fixtures, 'sample.patch'), 'utf8');
  const parsed = parse.parseUnifiedDiffText(patch);
  const hunkList = hunks.parseHunksFromUnifiedDiff(
    'src/foo.ts',
    parsed[0].unifiedDiff,
  );
  assert.equal(hunkList.length, 1);
  assert.equal(hunkList[0].id, 'src/foo.ts#0');
  const next = hunks.applyHunksToContent(oldC, hunkList, ['src/foo.ts#0']);
  assert.match(next, /gamma/);
  assert.match(next, /beta/);
});

test('reject hunk keeps original', () => {
  const oldC = 'alpha\nbeta\ndelta\n';
  const patch = readFileSync(join(fixtures, 'sample.patch'), 'utf8');
  const parsed = parse.parseUnifiedDiffText(patch);
  const hunkList = hunks.parseHunksFromUnifiedDiff(
    'src/foo.ts',
    parsed[0].unifiedDiff,
  );
  const next = hunks.applyHunksToContent(oldC, hunkList, []);
  assert.equal(next, oldC);
});

test('preview merges nextContent', () => {
  const preview = diff.buildFileDiffPreview(
    'x.ts',
    'a\nb\n',
    'a\nc\n',
  );
  assert.ok(preview.hunks.length >= 1);
  assert.equal(preview.nextContent, 'a\nc\n');
});

test('undoLast restores previous content (mock FS)', async () => {
  // serviceImpl imports vscode — stub before dynamic import
  const Module = await import('node:module');
  const mod = Module.default ?? Module;
  const prev = mod._load;
  const vscodeStub = {
    Disposable: class {
      constructor(fn) {
        this.dispose = typeof fn === 'function' ? fn : () => undefined;
      }
    },
    commands: { executeCommand: async () => undefined },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
    },
    workspace: {
      workspaceFolders: undefined,
      findFiles: async () => [],
      fs: {
        readFile: async () => new Uint8Array(),
        writeFile: async () => undefined,
      },
    },
    Uri: {
      joinPath: (_base, ...parts) => ({
        toString: () => 'file:///ws/' + parts.join('/'),
        path: '/ws/' + parts.join('/'),
      }),
      parse: (s) => ({ toString: () => s, path: s.replace(/^file:\/\//, '') }),
    },
  };
  mod._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscodeStub;
    return prev.apply(this, arguments);
  };
  try {
    const { createApplyService } = await import(
      join(dist, 'serviceImpl.js') + `?t=${Date.now()}`
    );
    const fs = new Map([['file:///ws/src/foo.ts', 'alpha\nbeta\ndelta\n']]);
    const apply = createApplyService(undefined, {
      resolveUri: async (p) => ({
        toString: () => `file:///ws/${p}`,
        path: `/ws/${p}`,
      }),
      readFile: async (uri) => fs.get(uri.toString()) ?? '',
      writeFile: async (uri, content) => {
        fs.set(uri.toString(), content);
      },
    });

    assert.equal(apply.canUndo(), false);
    const result = await apply.apply({
      source: 'chat',
      files: [
        { path: 'src/foo.ts', nextContent: 'alpha\nbeta\ngamma\ndelta\n' },
      ],
    });
    assert.equal(result.applied.length, 1);
    assert.ok(result.checkpointId);
    assert.equal(apply.canUndo(), true);
    assert.equal(
      fs.get('file:///ws/src/foo.ts'),
      'alpha\nbeta\ngamma\ndelta\n',
    );

    const n = await apply.undoLast();
    assert.equal(n, 1);
    assert.equal(fs.get('file:///ws/src/foo.ts'), 'alpha\nbeta\ndelta\n');
    assert.equal(apply.canUndo(), false);
    assert.equal(await apply.undoLast(), 0);
    apply.clearUndo();
  } finally {
    mod._load = prev;
  }
});
