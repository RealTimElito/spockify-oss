/**
 * Model provenance helpers — routed via spockify, never homelab infra.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ROUTED_VIA_SPOCKIFY,
  assertNoSparkLeak,
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

  it('never leaks homelab hostnames', () => {
    assert.equal(sanitizeModelId('spark/qwen'), 'qwen');
    assert.ok(!/spark/i.test(formatModelAttribution('spark-qwen')));
    assert.ok(!/cluster\.local/i.test(assertNoSparkLeak('talk to cluster.local')));
    assert.ok(!/homelab/i.test(assertNoSparkLeak('via homelab router')));
  });

  it('pickResolvedModel prefers response model', () => {
    assert.equal(
      pickResolvedModel('spockify-auto', 'codestral'),
      'codestral',
    );
  });
});
