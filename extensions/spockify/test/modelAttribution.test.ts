/**
 * Model provenance helpers — model · thinking, never Spark.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoSparkLeak,
  formatModelAttribution,
  formatModelLabel,
  pickResolvedModel,
  sanitizeModelId,
} from '../src/util/modelAttribution';

describe('modelAttribution', () => {
  it('formats model · thinking (not routed via spockify)', () => {
    assert.equal(
      formatModelAttribution('qwen2.5-coder', undefined, 'medium'),
      'qwen2.5-coder · Medium',
    );
    assert.equal(formatModelAttribution('qwen2.5-coder'), 'qwen2.5-coder');
    assert.equal(
      formatModelAttribution('gpt-oss:20b', undefined, 'auto'),
      'gpt-oss:20b · Auto',
    );
  });

  it('shows Auto · resolved when Auto picks a model', () => {
    assert.equal(
      formatModelAttribution('spockify-auto', 'qwen2.5-coder', 'auto'),
      'Auto · qwen2.5-coder · Auto',
    );
    assert.equal(formatModelLabel('spockify-auto'), 'Auto');
  });

  it('never leaks Spark / homelab hostnames', () => {
    assert.equal(sanitizeModelId('spark/qwen'), 'qwen');
    assert.ok(!/spark/i.test(formatModelAttribution('spark-qwen')));
    assert.ok(!/data\.local/i.test(assertNoSparkLeak('talk to example.local')));
    assert.ok(!/Spark/.test(assertNoSparkLeak('via Spark router')));
  });

  it('pickResolvedModel prefers response model', () => {
    assert.equal(
      pickResolvedModel('spockify-auto', 'codestral'),
      'codestral',
    );
  });
});
