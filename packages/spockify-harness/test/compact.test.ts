import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compactThread, estimateMessageTokens } from '../src/compactMessages';
import { applyTodoWrite } from '../src/todos';
import type { AgentMessage } from '../src/types';

describe('compactThread', () => {
  it('keeps the task and the latest user instruction', () => {
    const blob = 'x'.repeat(20_000);
    const messages: AgentMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Fix the login bug' },
      { role: 'assistant', content: 'reading' },
      { role: 'tool', name: 'read_file', toolCallId: 'c1', content: blob },
      { role: 'user', content: 'Also rename the helper' },
    ];
    assert.ok(estimateMessageTokens(messages) > 100);
    const packed = compactThread(messages, { maxTokens: 100, keepRecent: 1 });
    assert.equal(packed.compacted, true);
    const text = packed.messages.map((m) => m.content).join('\n');
    assert.match(text, /Fix the login bug/);
    assert.match(text, /Also rename the helper/);
    assert.match(text, /system prompt/);
    assert.ok(!text.includes(blob));
    assert.match(text, /Earlier turns compacted/);
  });

  it('leaves a short thread unchanged', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    const packed = compactThread(messages, { maxTokens: 24_000 });
    assert.equal(packed.compacted, false);
    assert.equal(packed.messages, messages);
  });

  it('records todos in the summary', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'task' },
      { role: 'tool', name: 'grep', toolCallId: 'g', content: 'y'.repeat(8000) },
      { role: 'user', content: 'latest' },
    ];
    const packed = compactThread(messages, {
      maxTokens: 50,
      keepRecent: 1,
      todos: [{ id: '1', content: 'Run tests', status: 'in_progress' }],
    });
    const summary = packed.messages.find((m) =>
      (m.content || '').includes('Earlier turns'),
    );
    assert.match(summary?.content || '', /\[in_progress\] Run tests/);
    assert.match(packed.messages.map((m) => m.content).join('\n'), /latest/);
  });
});

describe('applyTodoWrite', () => {
  it('merges by id and refuses a missing list', () => {
    const todos = [{ id: '1', content: 'Read', status: 'pending' as const }];
    const merged = applyTodoWrite(todos, {
      merge: true,
      todos: [{ id: '1', content: 'Read', status: 'completed' }, { id: '2', content: 'Test', status: 'nope' }],
    });
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    assert.equal(merged.todos[0]?.status, 'completed');
    assert.equal(merged.todos[1]?.status, 'pending');
    const missing = applyTodoWrite(undefined, { todos: [] });
    assert.equal(missing.ok, false);
  });
});
