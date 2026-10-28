/**
 * Agents Window rail ordering (no Electron).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agentsRailEmptyLabel, buildAgentsRail, swarmStatusLabel } from '../src/chat/agentsRail';

describe('buildAgentsRail', () => {
  it('lists open tabs before history and keeps an empty new chat', () => {
    const rail = buildAgentsRail({
      openTabIds: ['chat-new', 'chat-old'],
      sessions: [
        { id: 'chat-old', title: 'Fix the rail' },
        { id: 'chat-archive', title: 'Yesterday' },
      ],
      currentSessionId: 'chat-new',
      streamingTabIds: ['chat-old'],
    });
    assert.deepEqual(
      rail.map((row) => row.id),
      ['chat-new', 'chat-old', 'chat-archive'],
    );
    assert.equal(rail[0]?.title, 'New chat');
    assert.equal(rail[0]?.active, true);
    assert.equal(rail[1]?.streaming, true);
    assert.equal(rail[1]?.active, false);
    assert.equal(rail[2]?.title, 'Yesterday');
  });

  it('does not duplicate a thread that is both open and in history', () => {
    const rail = buildAgentsRail({
      openTabIds: ['a'],
      sessions: [{ id: 'a', title: 'Same' }],
      currentSessionId: 'a',
      streamingTabIds: [],
    });
    assert.equal(rail.length, 1);
    assert.equal(rail[0]?.title, 'Same');
  });

  it('maps swarm workers under the parent chat', () => {
    const rail = buildAgentsRail({
      openTabIds: ['chat'],
      sessions: [{ id: 'chat', title: 'Parent' }],
      currentSessionId: 'chat',
      streamingTabIds: [],
      swarmByParent: {
        chat: [
          {
            id: 'swarm_1',
            title: 'Add greet',
            state: 'running',
            prompt: 'Add greet() in greet.py',
          },
          {
            id: 'swarm_2',
            title: 'Pytest',
            state: 'failed',
            error: 'assertion failed',
            transcript: '### DONE — Pytest\nLAST_ERROR: assertion failed',
          },
          {
            id: 'swarm_3',
            title: 'Hang',
            state: 'cancelled',
          },
        ],
      },
    });
    assert.deepEqual(
      rail.map((row) => row.workerId || row.id),
      ['chat', 'swarm_1', 'swarm_2', 'swarm_3'],
    );
    assert.equal(rail[1]?.kind, 'swarm');
    assert.equal(rail[1]?.streaming, true);
    assert.equal(rail[1]?.cancellable, true);
    assert.equal(rail[1]?.statusLabel, 'running');
    assert.equal(rail[2]?.statusLabel, 'assertion failed');
    assert.equal(rail[2]?.error, 'assertion failed');
    assert.match(rail[2]?.transcript || '', /DONE — Pytest/);
    assert.equal(rail[3]?.statusLabel, 'stopped');
    assert.equal(rail[3]?.error, 'stopped');
    assert.equal(rail[3]?.cancellable, false);
    assert.equal(swarmStatusLabel('cancelled'), 'stopped');
    assert.equal(swarmStatusLabel('failed', 'pytest failed'), 'pytest failed');
  });

  it('empty rail copy is a new window until a filter misses', () => {
    assert.equal(agentsRailEmptyLabel('', 0), 'No chats yet.');
    assert.equal(agentsRailEmptyLabel('rail', 0), 'No matching chats.');
    assert.equal(agentsRailEmptyLabel('', 1), '');
  });
});
