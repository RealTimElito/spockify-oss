/**
 * Unit tests for the per-chat-tab FIFO send queue (prompt queueing feature —
 * "let the user keep typing/submitting while a turn streams, process in
 * order, don't drop, don't dump all in at once").
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  enqueueSend,
  dequeueSend,
  removeQueuedSend,
  queuedSendPreview,
  toQueuedSendViewList,
  resetQueuedSendIdsForTests,
  type QueuedSend,
} from '../src/chat/sendQueue';

describe('sendQueue', () => {
  beforeEach(() => {
    resetQueuedSendIdsForTests();
  });

  it('enqueue appends in FIFO order and assigns stable ids', () => {
    let q: QueuedSend[] = [];
    q = enqueueSend(q, { userText: 'first', model: 'm', withContext: false });
    q = enqueueSend(q, { userText: 'second', model: 'm', withContext: false });
    q = enqueueSend(q, { userText: 'third', model: 'm', withContext: false });
    assert.deepEqual(
      q.map((x) => x.userText),
      ['first', 'second', 'third'],
    );
    assert.deepEqual(
      new Set(q.map((x) => x.id)).size,
      3,
      'ids must be unique',
    );
  });

  it('dequeue pops the head and preserves remaining order', () => {
    let q: QueuedSend[] = [];
    q = enqueueSend(q, { userText: 'a', model: 'm', withContext: false });
    q = enqueueSend(q, { userText: 'b', model: 'm', withContext: false });
    q = enqueueSend(q, { userText: 'c', model: 'm', withContext: false });

    const first = dequeueSend(q);
    assert.equal(first.item?.userText, 'a');
    assert.deepEqual(
      first.rest.map((x) => x.userText),
      ['b', 'c'],
    );

    const second = dequeueSend(first.rest);
    assert.equal(second.item?.userText, 'b');
    assert.deepEqual(
      second.rest.map((x) => x.userText),
      ['c'],
    );

    const third = dequeueSend(second.rest);
    assert.equal(third.item?.userText, 'c');
    assert.equal(third.rest.length, 0);

    const empty = dequeueSend(third.rest);
    assert.equal(empty.item, undefined);
    assert.equal(empty.rest.length, 0);
  });

  it('processes 3 concurrent submissions in order with none dropped (simulated concurrent load)', () => {
    // Simulates: user hits enter 3x while streaming. All 3 must be queued
    // (none silently dropped) and drained strictly in submission order.
    let q: QueuedSend[] = [];
    const submissions = ['prompt A', 'prompt B', 'prompt C'];
    for (const text of submissions) {
      q = enqueueSend(q, { userText: text, model: 'spockify-auto', withContext: false });
    }
    assert.equal(q.length, 3, 'no submission was dropped');

    const drained: string[] = [];
    let cursor = q;
    while (cursor.length) {
      const { item, rest } = dequeueSend(cursor);
      if (item) drained.push(item.userText);
      cursor = rest;
    }
    assert.deepEqual(drained, submissions, 'drain order must match submission order');
  });

  it('removeQueuedSend(id) removes only that item; others keep their order', () => {
    let q: QueuedSend[] = [];
    q = enqueueSend(q, { userText: 'a', model: 'm', withContext: false });
    q = enqueueSend(q, { userText: 'b', model: 'm', withContext: false });
    q = enqueueSend(q, { userText: 'c', model: 'm', withContext: false });
    const bId = q[1].id;
    const after = removeQueuedSend(q, bId);
    assert.deepEqual(
      after.map((x) => x.userText),
      ['a', 'c'],
    );
  });

  it('removeQueuedSend() with no id clears the whole queue ("clear queued" affordance)', () => {
    let q: QueuedSend[] = [];
    q = enqueueSend(q, { userText: 'a', model: 'm', withContext: false });
    q = enqueueSend(q, { userText: 'b', model: 'm', withContext: false });
    const cleared = removeQueuedSend(q);
    assert.equal(cleared.length, 0);
  });

  it('queuedSendPreview truncates long text to a single-line summary', () => {
    assert.equal(queuedSendPreview('short'), 'short');
    assert.equal(queuedSendPreview('line one\nline two   with  spaces'), 'line one line two with spaces');
    const long = 'x'.repeat(100);
    const preview = queuedSendPreview(long, 20);
    assert.equal(preview.length, 20);
    assert.ok(preview.endsWith('…'));
  });

  it('toQueuedSendViewList maps to the plain {id, preview} shape sent to the webview', () => {
    let q: QueuedSend[] = [];
    q = enqueueSend(q, { userText: 'ping google.com', model: 'm', withContext: false });
    const view = toQueuedSendViewList(q);
    assert.deepEqual(view, [{ id: q[0].id, preview: 'ping google.com' }]);
  });
});
