/**
 * Chat session ordering and title derivation (no vscode).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPersistedChatSession,
  createChatSessionId,
  deriveChatTitle,
  listChatSessionSummaries,
  normalizeChatSession,
  sortChatSessionsForHistory,
  upsertChatSession,
  type PersistedChatSession,
} from '../src/runtime/chatSessionStore';

describe('chatSessionStore', () => {
  it('createChatSessionId returns unique chat- prefixed ids', () => {
    const a = createChatSessionId();
    const b = createChatSessionId();
    assert.match(a, /^chat-/);
    assert.notEqual(a, b);
  });

  it('deriveChatTitle uses first user message and strips context suffix', () => {
    const title = deriveChatTitle([
      { role: 'user', content: 'Fix the bug\n\n---\n[@file context]' },
    ]);
    assert.equal(title, 'Fix the bug');
  });

  it('deriveChatTitle keeps custom title when not default placeholder', () => {
    const title = deriveChatTitle(
      [{ role: 'user', content: 'hello' }],
      'My thread',
    );
    assert.equal(title, 'My thread');
  });

  it('normalizeChatSession fills v1 timestamps and mode from legacy rows', () => {
    const legacy = {
      id: 'chat-1',
      title: 'Old',
      messages: [{ role: 'user' as const, content: 'hi' }],
      updatedAt: 1000,
    };
    const n = normalizeChatSession(legacy);
    assert.equal(n.createdAt, 1000);
    assert.equal(n.lastMessageAt, 1000);
    assert.equal(n.mode, 'agent');
  });

  it('sortChatSessionsForHistory orders by lastMessageAt desc', () => {
    const sessions: PersistedChatSession[] = [
      {
        id: 'a',
        title: 'A',
        messages: [],
        createdAt: 1,
        updatedAt: 10,
        lastMessageAt: 100,
        mode: 'agent',
      },
      {
        id: 'b',
        title: 'B',
        messages: [],
        createdAt: 2,
        updatedAt: 20,
        lastMessageAt: 200,
        mode: 'ask',
      },
    ];
    const sorted = sortChatSessionsForHistory(sessions);
    assert.deepEqual(sorted.map((s) => s.id), ['b', 'a']);
  });

  it('upsertChatSession replaces same id and re-sorts', () => {
    const base: PersistedChatSession[] = [
      {
        id: 'old',
        title: 'Old',
        messages: [{ role: 'user', content: 'x' }],
        createdAt: 1,
        updatedAt: 50,
        lastMessageAt: 50,
        mode: 'agent',
      },
    ];
    const updated = buildPersistedChatSession(
      {
        id: 'old',
        messages: [
          { role: 'user', content: 'x' },
          { role: 'assistant', content: 'y' },
        ],
        mode: 'strict',
      },
      base[0],
    );
    assert.ok(updated);
    assert.equal(updated!.lastMessageAt, updated!.updatedAt);
    const merged = upsertChatSession(base, updated!);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].mode, 'strict');
  });

  it('listChatSessionSummaries exposes clock metadata', () => {
    const summaries = listChatSessionSummaries([
      {
        id: 'x',
        title: 'T',
        messages: [{ role: 'user', content: 'a' }],
        createdAt: 10,
        updatedAt: 30,
        lastMessageAt: 25,
        mode: 'agent',
        model: 'spockify-auto',
      },
    ]);
    assert.equal(summaries[0].createdAt, 10);
    assert.equal(summaries[0].lastMessageAt, 25);
    assert.equal(summaries[0].messageCount, 1);
    assert.equal(summaries[0].model, 'spockify-auto');
  });
});
