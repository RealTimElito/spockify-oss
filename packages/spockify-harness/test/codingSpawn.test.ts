import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ModelTransport } from '@spockify/ide-client';
import {
  childMayUseTool,
  codingSpawnEnabled,
  parseSpawnCoding,
  registerHarnessTools,
  runAgentTurn,
  spawnMarkerComplete,
  timeoutDigest,
  ToolRegistry,
} from '../src/index';
import type { HarnessEvent } from '../src/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function blob(req: { messages?: unknown }): string {
  return JSON.stringify(req.messages || []);
}

describe('coding spawn parse', () => {
  it('completes SPAWN_CODING JSON and caps at 2', () => {
    const text =
      'notes\nSPAWN_CODING:[' +
      '{"kind":"explore","prompt":"Find greet() and report FINDINGS for the parent."},' +
      '{"kind":"bash","prompt":"run pytest -q in the fixture"},' +
      '{"kind":"general","prompt":"this third child must be dropped by the cap"}' +
      ']';
    assert.equal(spawnMarkerComplete(text), true);
    const specs = parseSpawnCoding(text, 2);
    assert.equal(specs.length, 2);
    assert.equal(specs[0]!.kind, 'explore');
    assert.equal(specs[1]!.kind, 'bash');
    assert.equal(parseSpawnCoding(text).length, 1, 'canary default cap is 1');
  });

  it('rejects pentest children', () => {
    const specs = parseSpawnCoding(
      'SPAWN_CODING:[{"kind":"bash","prompt":"run nmap against the LAN"}]',
    );
    assert.equal(specs.length, 0);
  });

  it('timeoutDigest carries blocked:timeout', () => {
    const d = timeoutDigest('task_explore_x', 'explore', 'hang');
    assert.match(d, /blocked:timeout/);
    assert.match(d, /DONE — explore/);
  });
});

describe('mid-think spawn in runHarness loop', () => {
  it('breaks on SPAWN_CODING, runs a TaskAgent, merges digest, same model', async () => {
    let parentTurns = 0;
    const transport: ModelTransport = {
      async *streamChatCompletions(req) {
        const msg = blob(req);
        if (msg.includes('Find greet() in greet.py')) {
          yield { content: 'FINDINGS: greet() lives in greet.py\ndone' };
          return;
        }
        parentTurns += 1;
        if (parentTurns === 1) {
          yield {
            content:
              'Splitting work.\nSPAWN_CODING:[{"kind":"explore","prompt":"Find greet() in greet.py and summarize FINDINGS."}]\n',
          };
          yield { content: 'THIS_TUTORIAL_SHOULD_NOT_APPEAR' };
          return;
        }
        yield { content: 'greet() is in greet.py\ndone' };
      },
    } as unknown as ModelTransport;

    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const events: HarnessEvent[] = [];
    const messages = await runAgentTurn({
      transport,
      registry: reg,
      model: 'mock-parent',
      mode: 'build',
      messages: [{ role: 'user', content: 'fix greet' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 6,
      onEvent: (e) => events.push(e),
    });

    const spawns = events.filter((e) => e.type === 'taskSpawn');
    const dones = events.filter((e) => e.type === 'taskDone');
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0]!.kind, 'explore');
    assert.equal(dones.length, 1);
    assert.equal(parentTurns, 2);
    const merged = messages.some(
      (m) => m.role === 'user' && /DONE — explore/.test(m.content),
    );
    assert.ok(merged, 'expected DONE digest in parent context');
    assert.ok(!messages.some((m) => m.content.includes('THIS_TUTORIAL_SHOULD_NOT_APPEAR')));
    assert.ok(messages.some((m) => m.content.includes('greet() is in greet.py')));
  });

  it('does not spawn without structured SPAWN_CODING or task', async () => {
    const transport: ModelTransport = {
      async *streamChatCompletions() {
        yield {
          content:
            'I will spawn two children speculatively and then write a tutorial.\ndone',
        };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const events: HarnessEvent[] = [];
    await runAgentTurn({
      transport,
      registry: reg,
      model: 'mock',
      mode: 'build',
      messages: [{ role: 'user', content: 'fix greet' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
      onEvent: (e) => events.push(e),
    });
    assert.equal(events.filter((e) => e.type === 'taskSpawn').length, 0);
  });

  it('child cannot spawn a child', async () => {
    const transport: ModelTransport = {
      async *streamChatCompletions(req) {
        const msg = blob(req);
        if (msg.includes('nested spawn probe')) {
          yield {
            content:
              'SPAWN_CODING:[{"kind":"explore","prompt":"This grandchild must not run at all."}]',
          };
          return;
        }
        if (!msg.includes('COMPLETED WORK from TaskAgents')) {
          yield {
            content:
              'SPAWN_CODING:[{"kind":"explore","prompt":"nested spawn probe — look at greet.py FINDINGS"}]\n',
          };
          return;
        }
        yield { content: 'parent merged\ndone' };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const events: HarnessEvent[] = [];
    await runAgentTurn({
      transport,
      registry: reg,
      model: 'mock',
      mode: 'build',
      messages: [{ role: 'user', content: 'split' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 6,
      onEvent: (e) => events.push(e),
    });
    const spawns = events.filter((e) => e.type === 'taskSpawn');
    assert.equal(spawns.length, 1, `expected 1 spawn, got ${spawns.length}`);
    assert.equal(childMayUseTool('explore', 'task'), false);
    assert.equal(childMayUseTool('general', 'task'), false);
  });

  it('hard-timeouts a hanging child with blocked:timeout', async () => {
    const prev = process.env.SPOCKIFY_CODING_SPAWN_TIMEOUT_MS;
    process.env.SPOCKIFY_CODING_SPAWN_TIMEOUT_MS = '1000';
    try {
      let parentTurns = 0;
      const transport: ModelTransport = {
        async *streamChatCompletions(req) {
          parentTurns += 1;
          if (parentTurns === 1) {
            yield {
              content:
                'SPAWN_CODING:[{"kind":"bash","command":"sleep 30","prompt":"sleep 30"}]\n',
            };
            return;
          }
          yield { content: 'parent continued after timeout\ndone' };
        },
      } as unknown as ModelTransport;
      const reg = new ToolRegistry();
      registerHarnessTools(reg);
      const messages = await runAgentTurn({
        transport,
        registry: reg,
        model: 'mock',
        mode: 'build',
        messages: [{ role: 'user', content: 'split' }],
        cwd: process.cwd(),
        yolo: true,
        maxTurns: 6,
      });
      assert.equal(parentTurns, 2);
      assert.ok(
        messages.some((m) => m.role === 'user' && /blocked:timeout/.test(m.content)),
        'expected blocked:timeout digest',
      );
      assert.ok(messages.some((m) => m.content.includes('parent continued after timeout')));
    } finally {
      if (prev === undefined) delete process.env.SPOCKIFY_CODING_SPAWN_TIMEOUT_MS;
      else process.env.SPOCKIFY_CODING_SPAWN_TIMEOUT_MS = prev;
    }
  });

  it('does not import router midthought_spawn', async () => {
    const files = ['src/loop.ts', 'src/codingSpawn.ts', 'src/taskAgent.ts', 'src/tools.ts'];
    const importRe = /(?:from|import)\s+['"].*midthought_spawn/;
    const routerRe = /(?:from|import)\s+['"].*services\/router/;
    for (const rel of files) {
      const body = await fs.readFile(path.join(ROOT, rel), 'utf8');
      assert.doesNotMatch(body, importRe);
      assert.doesNotMatch(body, routerRe);
    }
    const prompt = await fs.readFile(path.join(ROOT, 'src/loop.ts'), 'utf8');
    assert.doesNotMatch(prompt, /CODING_SPAWN_STANZA/);
  });
});

describe('coding spawn env', () => {
  it('SPOCKIFY_CODING_SPAWN=0 disables spawn', () => {
    const prev = process.env.SPOCKIFY_CODING_SPAWN;
    process.env.SPOCKIFY_CODING_SPAWN = '0';
    try {
      assert.equal(codingSpawnEnabled(), false);
    } finally {
      if (prev === undefined) delete process.env.SPOCKIFY_CODING_SPAWN;
      else process.env.SPOCKIFY_CODING_SPAWN = prev;
    }
  });
});
