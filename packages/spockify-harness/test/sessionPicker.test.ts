import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_SESSION_PIN,
  isUserPinnedModel,
  parseRecommendJson,
  pickSessionModel,
  pinModelAfterWrite,
  sanitizeAutoPin,
  unpublishedLabModels,
} from '../src/index';

describe('session picker', () => {
  it('defaults to 20b think=off and never returns lab ids', async () => {
    const pin = await pickSessionModel({});
    assert.deepEqual(pin, DEFAULT_SESSION_PIN);
    assert.equal(pin.model, 'gpt-oss-20b');
    assert.equal(pin.think, 'off');
    for (const row of unpublishedLabModels()) {
      assert.notEqual(sanitizeAutoPin({ model: row.id }).model, row.id);
    }
    assert.equal(sanitizeAutoPin({ model: 'devstral-2' }).model, 'gpt-oss-20b');
    assert.equal(
      sanitizeAutoPin({ model: 'qwen3-coder-30b-a3b' }).model,
      'gpt-oss-20b',
    );
  });

  it('lets user --model win, including lab tags', async () => {
    assert.equal(isUserPinnedModel('qwen3-coder-30b-a3b'), true);
    assert.equal(isUserPinnedModel('spockify-auto'), false);
    assert.equal(isUserPinnedModel('auto'), false);
    assert.equal(isUserPinnedModel(undefined), false);
    const qwen = await pickSessionModel({
      userModel: 'qwen3-coder-30b-a3b',
      userThink: 'high',
      recommend: async () => ({ model: 'gpt-oss-120b', think: 'high' }),
    });
    assert.deepEqual(qwen, { model: 'qwen3-coder-30b-a3b', think: 'high' });
    const pinned = await pickSessionModel({
      userModel: 'gpt-oss-120b',
      prompt: 'refactor the whole package',
      recommend: async () => ({ model: 'gpt-oss-20b', think: 'off' }),
    });
    assert.equal(pinned.model, 'gpt-oss-120b');
  });

  it('uses a mocked recommend path (no live GPU)', async () => {
    const pin = await pickSessionModel({
      prompt: 'failing tests across three packages',
      recommend: async () => ({ model: 'gpt-oss-120b', think: 'high' }),
    });
    assert.deepEqual(pin, { model: 'gpt-oss-120b', think: 'high' });
    const labRec = await pickSessionModel({
      prompt: 'big architecture change',
      recommend: async () => ({ model: 'devstral-2', think: 'off' }),
    });
    assert.deepEqual(labRec, DEFAULT_SESSION_PIN);
    const down = await pickSessionModel({
      prompt: 'hard multi-file refactor',
      recommend: async () => {
        throw new Error('LiteLLM unreachable');
      },
    });
    assert.deepEqual(down, DEFAULT_SESSION_PIN);
  });

  it('parses recommend JSON and ignores non-JSON', () => {
    assert.deepEqual(parseRecommendJson('{"model":"gpt-oss-120b","think":"high"}'), {
      model: 'gpt-oss-120b',
      think: 'high',
    });
    assert.equal(parseRecommendJson('use 120b because this is hard'), null);
    assert.equal(parseRecommendJson(''), null);
  });

  it('keeps the write pin lock', () => {
    assert.equal(pinModelAfterWrite('spockify-auto', 'gpt-oss-20b'), 'gpt-oss-20b');
    assert.equal(pinModelAfterWrite('gpt-oss-20b', 'gpt-oss-120b'), 'gpt-oss-20b');
  });
});
