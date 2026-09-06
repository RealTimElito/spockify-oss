/**
 * Chat display filter — hide tool syntax while streaming.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DisplayStreamFilter,
  assistantTextForDisplay,
} from '../src/runtime/displayStreamFilter';
import { stripToolFences } from '../src/runtime/parseToolCalls';

describe('displayStreamFilter', () => {
  it('strips tool Apply fenced JSON', () => {
    const raw =
      'Checking…\n```tool Apply\n{"name":"terminal_run","arguments":{"command":"pwd"}}\n```\nDone.';
    assert.equal(
      stripToolFences(raw).trim(),
      'Checking…\n\nDone.',
    );
  });

  it('buffers incomplete ```tool fence during stream', () => {
    const f = new DisplayStreamFilter();
    assert.equal(f.push('Hello ```tool\n{'), 'Hello ');
    assert.equal(f.push('"name":"x"}\n```\nBye').trimStart(), 'Bye');
  });

  it('strips tool NAME { json } one-liner', () => {
    const raw = 'Hi\ntool Apply {"name":"terminal_run","arguments":{"command":"ls"}}\nOk';
    assert.match(assistantTextForDisplay(raw), /Hi/);
    assert.match(assistantTextForDisplay(raw), /Ok/);
    assert.doesNotMatch(assistantTextForDisplay(raw), /terminal_run/);
  });

  it('strips bare {"name","arguments"} tool JSON line', () => {
    const raw =
      'Plan:\n{"name":"write_file","arguments":{"path":"a.ts","content":"x"}}\nDone.';
    const out = assistantTextForDisplay(raw);
    assert.match(out, /Plan/);
    assert.match(out, /Done/);
    assert.doesNotMatch(out, /write_file/);
  });

  it('strips partial tool JSON object during streaming', () => {
    const f = new DisplayStreamFilter();
    const delta1 = f.push(
      'Start\n{"name":"terminal_run","arguments":{',
    );
    assert.match(delta1, /Start/);
    assert.doesNotMatch(delta1, /terminal_run/);

    const delta2 = f.push('\"command\":\"pwd\"}}}\nDone.');
    assert.match(delta2, /Done/);
    assert.doesNotMatch(delta2, /terminal_run/);
  });

  it('does not leak partial tool suffixes across reset (tab rehydration)', () => {
    const f = new DisplayStreamFilter();
    f.push('Chat A\n{"name":"terminal_run","arguments":{');
    f.reset();
    const delta = f.push('Chat B\nDone.');
    assert.match(delta, /Chat B/);
    assert.doesNotMatch(delta, /terminal_run/);
  });
});
