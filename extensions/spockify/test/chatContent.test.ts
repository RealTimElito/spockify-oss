/**
 * Multimodal user content + attachment helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildUserContentFromAttachments,
  textFromContent,
  type ChatAttachmentPayload,
} from '../src/chat/chatContent';

describe('chatContent', () => {
  it('returns plain string without attachments', () => {
    assert.equal(buildUserContentFromAttachments('hi'), 'hi');
  });

  it('embeds images as image_url parts', () => {
    const atts: ChatAttachmentPayload[] = [
      {
        id: 'a1',
        name: 'shot.png',
        mimeType: 'image/png',
        kind: 'image',
        dataUrl: 'data:image/png;base64,aaa',
        size: 12,
      },
    ];
    const content = buildUserContentFromAttachments('look', atts);
    assert.ok(Array.isArray(content));
    assert.equal(content[0].type, 'text');
    assert.equal(content[1].type, 'image_url');
    if (content[1].type === 'image_url') {
      assert.equal(content[1].image_url.url, 'data:image/png;base64,aaa');
    }
  });

  it('inlines text file bodies', () => {
    const content = buildUserContentFromAttachments('', [
      {
        id: 'f1',
        name: 'notes.md',
        mimeType: 'text/markdown',
        kind: 'file',
        textContent: '# hi',
        size: 4,
      },
    ]);
    assert.equal(typeof content, 'string');
    assert.match(String(content), /Attached file: notes\.md/);
    assert.match(String(content), /# hi/);
  });

  it('textFromContent flattens parts', () => {
    assert.equal(
      textFromContent([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: 'data:x' } },
        { type: 'text', text: 'b' },
      ]),
      'a\nb',
    );
  });
});
