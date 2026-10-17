import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessionManager } from '../src/runtime/sessionManager';
import { shouldDeliverStreamToView } from '../src/runtime/chatTabAgentHost';

describe('shouldDeliverStreamToView', () => {
  it('delivers when tab id matches or is omitted', () => {
    assert.equal(shouldDeliverStreamToView('tab-a', 'tab-a'), true);
    assert.equal(shouldDeliverStreamToView(undefined, 'tab-a'), true);
  });

  it('drops events for background tabs', () => {
    assert.equal(shouldDeliverStreamToView('tab-b', 'tab-a'), false);
  });
});

describe('SessionManager chatTabId routing', () => {
  it('maps chat tab id to agent session for cancel/pause', () => {
    const mgr = new SessionManager();
    const s = mgr.create('agent', 'chat', 'chat-tab-1');
    assert.equal(mgr.resolveSessionId('chat-tab-1'), s.id);
    assert.equal(mgr.getByChatTabId('chat-tab-1')?.id, s.id);
    assert.equal(mgr.pauseByChatTabId('chat-tab-1'), true);
    assert.equal(mgr.resumeByChatTabId('chat-tab-1'), true);
    assert.equal(mgr.cancelByChatTabId('chat-tab-1'), true);
    assert.equal(mgr.resolveSessionId('chat-tab-1'), undefined);
  });

  it('does not affect composer/terminal sessions without chatTabId', () => {
    const mgr = new SessionManager();
    const term = mgr.create('agent', 'terminal');
    assert.equal(mgr.resolveSessionId('chat-tab-2'), undefined);
    assert.equal(mgr.cancel(term.id), true);
  });
});
