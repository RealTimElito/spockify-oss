import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInlinePreviewDocument,
  replaceRangeInText,
} from '../src/inlineEdit/proposedContent';
import { shouldResumeStreamingAfterHistory } from '../src/chat/streamResume';

describe('buildInlinePreviewDocument', () => {
  it('interleaves removed then added for a mid-block edit', () => {
    const doc = buildInlinePreviewDocument('a\nold\nb', 'a\nnew\nb');
    assert.deepEqual(
      doc.lines.map((l) => [l.kind, l.text]),
      [
        ['context', 'a'],
        ['removed', 'old'],
        ['added', 'new'],
        ['context', 'b'],
      ],
    );
    assert.deepEqual(doc.removedLineIndexes, [1]);
    assert.deepEqual(doc.addedLineIndexes, [2]);
  });

  it('handles pure insertion', () => {
    const doc = buildInlinePreviewDocument('a\nb', 'a\nx\nb');
    assert.equal(doc.removedLineIndexes.length, 0);
    assert.deepEqual(doc.addedLineIndexes, [1]);
    assert.equal(doc.lines[1]?.text, 'x');
  });
});

describe('replaceRangeInText', () => {
  it('replaces a byte range', () => {
    assert.equal(replaceRangeInText('abcdef', 2, 4, 'XX'), 'abXXef');
  });
});

describe('shouldResumeStreamingAfterHistory', () => {
  it('resumes when host asks', () => {
    assert.equal(
      shouldResumeStreamingAfterHistory({
        resumeStreaming: true,
        wasLocallyStreaming: false,
        tabListedAsStreaming: false,
        acceptStreamEvents: false,
      }),
      true,
    );
  });

  it('does not re-arm from stale tab ids after done', () => {
    assert.equal(
      shouldResumeStreamingAfterHistory({
        resumeStreaming: false,
        wasLocallyStreaming: false,
        tabListedAsStreaming: true,
        acceptStreamEvents: false,
      }),
      false,
    );
  });

  it('resumes mid-turn when acceptStreamEvents is live', () => {
    assert.equal(
      shouldResumeStreamingAfterHistory({
        resumeStreaming: false,
        wasLocallyStreaming: true,
        tabListedAsStreaming: false,
        acceptStreamEvents: true,
      }),
      true,
    );
  });
});


describe('buildInlinePreviewDocument deletion', () => {
  it('handles pure deletion', () => {
    const doc = buildInlinePreviewDocument('a\nx\nb', 'a\nb');
    assert.deepEqual(doc.removedLineIndexes, [1]);
    assert.equal(doc.addedLineIndexes.length, 0);
    assert.equal(doc.lines[1]?.kind, 'removed');
  });

  it('empty both yields one context line', () => {
    const doc = buildInlinePreviewDocument('', '');
    assert.equal(doc.lines.length, 1);
    assert.equal(doc.lines[0]?.kind, 'context');
  });
});
