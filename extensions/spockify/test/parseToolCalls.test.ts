/**
 * parseToolCalls unit tests
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseToolCalls,
  stripToolFences,
} from '../src/runtime/parseToolCalls';

describe('parseToolCalls', () => {
  it('parses fenced tool JSON', () => {
    const text = `Sure.\n\`\`\`tool\n{"name":"terminal_run","arguments":{"command":"pwd"}}\n\`\`\`\n`;
    const calls = parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'terminal_run');
    assert.equal(calls[0].arguments.command, 'pwd');
  });

  it('parses XML tool_call wrappers', () => {
    const text =
      '<tool_call>{"name":"apply_patch","args":{"path":"a.ts"}}</tool_call>';
    const calls = parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'apply_patch');
  });

  it('parses hallucinated terminal_run bash "…" prose', () => {
    const text = 'Here:\nterminal_run bash "kubectl get pods -A"\n';
    const calls = parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'terminal_run');
    assert.equal(calls[0].arguments.command, 'kubectl get pods -A');
  });

  it('parses terminal_run inside bash fence', () => {
    const text =
      '```bash\nterminal_run bash "ls -la"\n```';
    const calls = parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].arguments.command, 'ls -la');
  });

  it('promotes lone bash fence when opted in', () => {
    const text = '```bash\nkubectl get nodes\n```';
    assert.equal(parseToolCalls(text).length, 0);
    const calls = parseToolCalls(text, { promoteShellFences: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'terminal_run');
    assert.equal(calls[0].arguments.command, 'kubectl get nodes');
  });

  it('does not promote markdown fence bodies as terminal_run', () => {
    const text =
      '```bash\n### 2. Integrate into the FastAPI App\nIn your routes add BackgroundTasks.\n```';
    const calls = parseToolCalls(text, { promoteShellFences: true });
    assert.equal(calls.length, 0);
  });

  it('stripToolFences hides terminal_run bash hallucinations', () => {
    const text =
      'Hi\n```bash\nterminal_run bash "pwd"\n```\nBye';
    assert.equal(stripToolFences(text).replace(/\s+/g, ' ').trim(), 'Hi Bye');
  });
});
