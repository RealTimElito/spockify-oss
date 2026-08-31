import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {
  assertOssModel,
  filterOssModels,
  isAllowedOssModel,
  isDeniedModel,
} from './index';

test('allows Spockify OSS aliases', () => {
  assert.equal(isAllowedOssModel('spockify-auto'), true);
  assert.equal(isAllowedOssModel('codestral'), true);
  assert.equal(isAllowedOssModel('gpt-oss-20b'), true);
  assert.equal(isAllowedOssModel('spockify-agents'), true);
});

test('allows local catalog families', () => {
  assert.equal(isAllowedOssModel('gemma4-31b'), true);
  assert.equal(isAllowedOssModel('qwen3.6-coder-27b'), true);
  assert.equal(isAllowedOssModel('magistral'), true);
  assert.equal(isAllowedOssModel('devstral-small-2'), true);
  assert.equal(isAllowedOssModel('ministral-3-14b'), true);
  assert.equal(isAllowedOssModel('nemotron-70b'), true);
  assert.equal(isAllowedOssModel('gpt-oss:120b'), true);
  assert.equal(isAllowedOssModel('kimi-k2.5:cloud'), false);
  assert.equal(isDeniedModel('kimi-k2.5:cloud'), true);
});

test('denies closed cloud ids', () => {
  assert.equal(isDeniedModel('gpt-4o'), true);
  assert.equal(isDeniedModel('claude-3-opus'), true);
  assert.equal(isAllowedOssModel('gpt-4o'), false);
});

test('filterOssModels strips closed', () => {
  const out = filterOssModels([
    {id: 'spockify-auto'},
    {id: 'gpt-4'},
    {id: 'gpt-oss-20b'},
    {id: 'codestral'},
    {id: 'claude-sonnet-4'},
  ]);
  assert.deepEqual(
    out.map((m) => m.id),
    ['spockify-auto', 'gpt-oss-20b', 'codestral'],
  );
});

test('assertOssModel throws on gpt', () => {
  assert.throws(() => assertOssModel('gpt-4o'), /blocked/);
});
