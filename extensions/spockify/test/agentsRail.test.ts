/**
 * Agents Window rail ordering (no Electron).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAgentsRail } from '../src/chat/agentsRail';

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
});
