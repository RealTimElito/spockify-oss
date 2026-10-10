/**
 * OpenAI-shaped assistant.tool_calls history flatten.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flattenAgentMessagesForApi } from '../src/runtime/agentLoop';
import type { AgentMessage } from '../src/runtime/types';

describe('flattenAgentMessagesForApi', () => {
  it('emits assistant.tool_calls then role:tool with matching ids', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'list files' },
      {
        role: 'assistant',
        content: 'Checking…',
        toolCalls: [
          {
            id: 'call_1',
            name: 'terminal_run',
            arguments: { command: 'ls' },
          },
        ],
      },
      {
        role: 'tool',
        name: 'terminal_run',
        toolCallId: 'call_1',
        content: 'a.ts\nb.ts',
      },
      { role: 'assistant', content: 'You have two files.' },
    ];

    const api = flattenAgentMessagesForApi(messages);
    assert.equal(api.length, 5);
    assert.equal(api[2].role, 'assistant');
    assert.ok(api[2].tool_calls);
    assert.equal(api[2].tool_calls!.length, 1);
    assert.equal(api[2].tool_calls![0].id, 'call_1');
    assert.equal(api[2].tool_calls![0].type, 'function');
    assert.equal(api[2].tool_calls![0].function.name, 'terminal_run');
    assert.equal(
      api[2].tool_calls![0].function.arguments,
      JSON.stringify({ command: 'ls' }),
    );
    assert.equal(api[3].role, 'tool');
    assert.equal(api[3].tool_call_id, 'call_1');
    assert.equal(api[3].content, 'a.ts\nb.ts');
    assert.equal(api[4].role, 'assistant');
    assert.equal(api[4].tool_calls, undefined);
  });

  it('user-wraps tool results when toolCallId missing (OSS fallback)', () => {
    const api = flattenAgentMessagesForApi([
      {
        role: 'tool',
        name: 'search',
        content: 'hit',
      },
    ]);
    assert.equal(api.length, 1);
    assert.equal(api[0].role, 'user');
    assert.match(api[0].content, /Tool result \(search\)/);
  });
});
