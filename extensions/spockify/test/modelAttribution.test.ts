/**
 * Model provenance helpers — routed via spockify, never internal hosts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ROUTED_VIA_SPOCKIFY,
  assertNoHostLeak,
  formatModelAttribution,
  formatModelLabel,
  pickResolvedModel,
  sanitizeModelId,
} from '../src/util/modelAttribution';

describe('modelAttribution', () => {
  it('formats exact provenance string', () => {
    assert.equal(
      formatModelAttribution('qwen2.5-coder'),
      `qwen2.5-coder · ${ROUTED_VIA_SPOCKIFY}`,
    );
    assert.equal(ROUTED_VIA_SPOCKIFY, 'routed via spockify');
  });

  it('shows Auto · resolved when Auto picks a model', () => {
    assert.equal(
      formatModelAttribution('spockify-auto', 'qwen2.5-coder'),
      `Auto · qwen2.5-coder · ${ROUTED_VIA_SPOCKIFY}`,
    );
    assert.equal(formatModelLabel('spockify-auto'), 'Auto');
  });

  it('never leaks internal backend hostnames', () => {
    assert.equal(sanitizeModelId('litellm/qwen'), 'qwen');
    assert.ok(!/litellm/i.test(formatModelAttribution('litellm-qwen')));
    assert.ok(!/\.local/i.test(assertNoHostLeak('talk to mybox.local')));
    assert.ok(!/localhost/i.test(assertNoHostLeak('call localhost now')));
  });

  it('pickResolvedModel prefers response model', () => {
    assert.equal(
      pickResolvedModel('spockify-auto', 'codestral'),
      'codestral',
    );
  });
});
