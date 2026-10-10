import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSelectableCodingId } from '@spockify/harness';
import { formatApiErrorDetail } from '@spockify/ide-client';
import { resolveModelId } from '../src/models';
import {
  LOCAL_OLLAMA_BASE,
  resolveLabPinTarget,
} from '../src/labPin';

describe('CLI --model lab pins', () => {
  it('resolves unpublished lab ids without a live stack', () => {
    assert.equal(resolveModelId('devstral-small-2'), 'devstral-small-2');
    assert.equal(resolveModelId('devstral-2'), 'devstral-2');
    assert.equal(resolveModelId('qwen3-coder-30b-a3b'), 'qwen3-coder-30b-a3b');
    assert.equal(resolveModelId('qwen3-coder'), 'qwen3-coder-30b-a3b');
    assert.equal(isSelectableCodingId('qwen3-coder-30b-a3b'), true);
    assert.equal(isSelectableCodingId('devstral-2'), true);
  });

  it('routes a lab pin to local Ollama when the mapped tag is present', async () => {
    const pin = await resolveLabPinTarget({
      catalogId: 'qwen3-coder-30b-a3b',
      configuredBaseUrl: 'https://spockify.eu',
      listModels: async (url) =>
        url.includes('11434')
          ? ['llama3.1:latest', 'qwen3-coder:30b-a3b-q4_K_M']
          : ['gpt-oss-20b'],
    });
    assert.equal(pin.kind, 'ollama');
    assert.equal(pin.baseUrl, LOCAL_OLLAMA_BASE);
    assert.equal(pin.apiModel, 'qwen3-coder:30b-a3b-q4_K_M');
  });

  it('errors clearly when prod and local Ollama lack the lab model', async () => {
    await assert.rejects(
      () =>
        resolveLabPinTarget({
          catalogId: 'qwen3-coder-30b-a3b',
          configuredBaseUrl: 'https://spockify.eu',
          listModels: async () => [],
        }),
      /lab model.*spockify\.eu/i,
    );
  });

  it('prints the API JSON error body on 400', () => {
    assert.match(
      formatApiErrorDetail(
        '{"error":{"message":"model \'qwen3-coder-30b-a3b\' not found"}}',
      ),
      /qwen3-coder-30b-a3b.*not found/,
    );
  });
});
