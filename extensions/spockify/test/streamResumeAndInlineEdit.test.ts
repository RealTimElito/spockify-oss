import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldResumeStreamingAfterHistory } from '../src/chat/streamResume';
import { replaceRangeInText } from '../src/inlineEdit/proposedContent';

describe('shouldResumeStreamingAfterHistory', () => {
  it('resumes when host sets resumeStreaming', () => {
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

  it('does not resume after terminal turn from stale streamingTabIds', () => {
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

  it('resumes mid-turn from local or tab streaming while accept is open', () => {
    assert.equal(
      shouldResumeStreamingAfterHistory({
        resumeStreaming: false,
        wasLocallyStreaming: true,
        tabListedAsStreaming: false,
        acceptStreamEvents: true,
      }),
      true,
    );
    assert.equal(
      shouldResumeStreamingAfterHistory({
        resumeStreaming: false,
        wasLocallyStreaming: false,
        tabListedAsStreaming: true,
        acceptStreamEvents: true,
      }),
      true,
    );
  });
});

describe('replaceRangeInText', () => {
  it('replaces the selected span for Ctrl+K full-file staging', () => {
    assert.equal(replaceRangeInText('abcDEF', 3, 6, 'xyz'), 'abcxyz');
    assert.equal(replaceRangeInText('hello', 0, 5, 'hi'), 'hi');
    assert.equal(replaceRangeInText('ab', 1, 1, 'X'), 'aXb');
  });
});
