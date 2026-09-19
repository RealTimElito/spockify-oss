/**
 * Mentions + mergeToolCalls + composer plan helpers
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeToolCalls,
  parseToolCalls,
  stripToolFences,
} from '../src/runtime/parseToolCalls';
import { parseMentions } from '../src/rules/mentions';
import {
  looksMultiFile,
  hasPlanShape,
  formatVerifyFailureContext,
} from '../src/composer/plan';
import {
  collectComposerPatches,
  patchesFromApplyArgs,
  mergePatchesByPath,
} from '../src/composer/collectPatches';

describe('parseToolCalls extras', () => {
  it('parses named xml tool_call', () => {
    const text =
      '<tool_call name="terminal_run">{"command":"ls"}</tool_call>';
    const calls = parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'terminal_run');
    assert.equal(calls[0].arguments.command, 'ls');
  });

  it('parses invoke one-liner', () => {
    const text = 'call codebase_search with {"query":"AgentRuntime"}';
    const calls = parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'codebase_search');
  });

  it('mergeToolCalls prefers native and adds unique fences', () => {
    const native = [
      { id: '1', name: 'terminal_run', arguments: { command: 'pwd' } },
    ];
    const fenced = parseToolCalls(
      '```tool\n{"name":"terminal_run","arguments":{"command":"pwd"}}\n```\n```tool\n{"name":"codebase_search","arguments":{"query":"x"}}\n```',
    );
    const merged = mergeToolCalls(native, fenced);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].id, '1');
    assert.equal(merged[1].name, 'codebase_search');
  });

  it('stripToolFences removes named xml', () => {
    const text =
      'Hi\n<tool_call name="x">{}</tool_call>\nBye';
    assert.equal(stripToolFences(text), 'Hi\n\nBye');
  });
});

describe('parseMentions', () => {
  it('extracts @file paths and cleans query', () => {
    const m = parseMentions(
      'Fix @file src/runtime/agentLoop.ts and @codebase pause resume',
    );
    assert.ok(m.kinds.has('file'));
    assert.ok(m.kinds.has('codebase'));
    assert.ok(m.filePaths.some((p) => p.includes('agentLoop.ts')));
    assert.ok(!/@codebase/i.test(m.cleanQuery));
    assert.match(m.cleanQuery, /pause resume/i);
  });

  it('parses @folder', () => {
    const m = parseMentions('@folder extensions/spockify explain indexing');
    assert.ok(m.kinds.has('folder'));
    assert.equal(m.folderPaths[0], 'extensions/spockify');
  });
});

describe('composer plan/patches', () => {
  it('looksMultiFile detects multi paths', () => {
    assert.equal(looksMultiFile('update auth.ts and http.ts'), true);
    assert.equal(looksMultiFile('fix typo'), false);
  });

  it('hasPlanShape', () => {
    assert.equal(hasPlanShape('## Plan\n1. a\n2. b'), true);
    assert.equal(hasPlanShape('sure'), false);
  });

  it('patchesFromApplyArgs + merge', () => {
    const a = patchesFromApplyArgs({
      files: [
        { path: 'a.ts', content: '1' },
        { path: 'b.ts', content: '2' },
      ],
    });
    const b = patchesFromApplyArgs({ path: 'a.ts', content: '3' });
    const merged = mergePatchesByPath([...a, ...b]);
    assert.equal(merged.find((p) => p.path === 'a.ts')?.content, '3');
    assert.equal(merged.length, 2);
  });

  it('collectComposerPatches combines fences and tools', () => {
    const text = '```src/foo.ts\nhello\n```';
    const patches = collectComposerPatches({
      assistantText: text,
      toolApplyArgs: [{ files: [{ path: 'bar.ts', content: 'x' }] }],
    });
    assert.equal(patches.length, 2);
  });

  it('formatVerifyFailureContext', () => {
    const s = formatVerifyFailureContext('npm test', {
      exitCode: 1,
      stdout: 'FAIL',
    });
    assert.match(s, /npm test/);
    assert.match(s, /FAIL/);
  });
});

describe('composer session transcript', () => {
  it('historyForNextTurn prefers agentMessages with tools', () => {
    const {
      createComposerSession,
      historyForNextTurn,
      recordAgentTranscript,
      recordTurn,
    } = require('../src/composer/session') as typeof import('../src/composer/session');
    const session = createComposerSession();
    recordTurn(session, 'user1', 'asst1', []);
    recordAgentTranscript(session, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user1' },
      {
        role: 'assistant',
        content: 'asst1',
        toolCalls: [{ id: 'c1', name: 'apply_patch', arguments: {} }],
      },
      {
        role: 'tool',
        content: 'ok',
        toolCallId: 'c1',
        name: 'apply_patch',
      },
    ]);
    const hist = historyForNextTurn(session);
    assert.equal(hist.some((m) => m.role === 'system'), false);
    assert.equal(hist.some((m) => m.role === 'tool'), true);
    assert.ok(
      hist.find((m) => m.role === 'assistant')?.toolCalls?.length,
    );
  });
});
