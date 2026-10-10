import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Harness Profile v0 schema', () => {
  it('schema file lists all HarnessEvent type discriminators', () => {
    const schema = fs.readFileSync(
      path.join(root, 'schema/harness-event.v0.json'),
      'utf8',
    );
    for (const t of [
      'status',
      'model',
      'text',
      'thinking',
      'toolStart',
      'toolResult',
      'toolKilled',
      'loopWarning',
      'compact',
      'taskSpawn',
      'taskDone',
      'askUser',
      'agents',
      'done',
      'error',
    ]) {
      assert.match(schema, new RegExp(`"const": "${t}"`));
    }
  });

  it('fixture events.jsonl parses as HarnessEvent-shaped objects', () => {
    const lines = fs
      .readFileSync(path.join(root, 'fixtures/profile-v0/events.jsonl'), 'utf8')
      .trim()
      .split('\n');
    const events = lines.map((l) => JSON.parse(l) as { type: string });
    assert.ok(events.length >= 4);
    assert.equal(events[0]!.type, 'status');
    assert.equal(events.at(-1)!.type, 'done');
  });
});
