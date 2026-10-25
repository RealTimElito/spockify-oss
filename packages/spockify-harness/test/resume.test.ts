import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { ModelTransport } from '@spockify/ide-client';
import {
  SESSION_SCHEMA_VERSION,
  SessionSchemaError,
  ToolRegistry,
  loadSession,
  persistSession,
  registerHarnessTools,
  runHarness,
} from '../src/index';
import type { HarnessEvent, HarnessSession } from '../src/types';

describe('interrupt / resume', () => {
  it('abort emits cancelled, persist+load keeps messages', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-'));
    const ac = new AbortController();
    const transport = {
      async *streamChatCompletions() {
        yield { content: 'partial-' };
        ac.abort();
        yield { content: 'should-not-need-this' };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const session: HarnessSession = {
      messages: [{ role: 'user', content: 'continue this' }],
      tick: 0,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd: dir,
      model: 'mock',
    };
    const events: HarnessEvent[] = [];
    for await (const ev of runHarness({
      transport,
      session,
      registry: reg,
      policy: { mode: 'build', maxTurns: 4, yolo: true },
      signal: ac.signal,
    })) {
      events.push(ev);
    }
    const done = events.filter((e) => e.type === 'done').pop();
    assert.ok(done && done.type === 'done');
    assert.equal(done.cancelled || done.reason === 'cancelled', true);

    await persistSession(dir, 's1', session);
    const loaded = await loadSession(dir, 's1');
    assert.ok(loaded);
    assert.equal(loaded.schemaVersion, SESSION_SCHEMA_VERSION);
    assert.ok(loaded.messages.some((m) => m.role === 'user'));

    const contEvents: HarnessEvent[] = [];
    const cont: ModelTransport = {
      async *streamChatCompletions() {
        yield { content: 'resumed\ndone' };
      },
    } as unknown as ModelTransport;
    for await (const ev of runHarness({
      transport: cont,
      session: loaded,
      registry: reg,
      policy: { mode: 'ask', maxTurns: 3, yolo: true },
    })) {
      contEvents.push(ev);
    }
    assert.ok(
      contEvents.some((e) => e.type === 'text' && e.content.includes('resumed')),
    );
  });

  it('newer schemaVersion is a hard incompatible-session error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'schema-'));
    await fs.writeFile(
      path.join(dir, 's1.jsonl'),
      JSON.stringify({
        schemaVersion: SESSION_SCHEMA_VERSION + 9,
        tick: 1,
        cwd: dir,
        model: 'x',
        readSet: [],
        toolLog: [],
        todos: [],
        messages: [],
      }) + '\n',
      'utf8',
    );
    await assert.rejects(
      () => loadSession(dir, 's1'),
      (err: unknown) =>
        err instanceof SessionSchemaError && /incompatible session schema/.test(err.message),
    );
  });

  it('corrupt JSONL does not throw', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'corrupt-'));
    await fs.writeFile(path.join(dir, 's1.jsonl'), '{not json\n', 'utf8');
    assert.equal(await loadSession(dir, 's1'), null);
  });
});
