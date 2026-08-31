import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_MODEL_ID,
  catalogAliases,
  getCatalogModel,
  isDeniedPickerId,
  mergePickerModels,
} from '../src/chat/modelCatalog';

describe('modelCatalog', () => {
  it('lists local chat aliases (no Kimi / MiMo)', () => {
    const aliases = catalogAliases();
    assert.ok(aliases.includes('gemma4-31b'));
    assert.ok(aliases.includes('gpt-oss-120b'));
    assert.ok(aliases.includes('gpt-oss-20b'));
    assert.ok(aliases.includes('qwen3.6-coder-27b'));
    assert.ok(aliases.includes('qwen3.5-9b'));
    assert.ok(aliases.includes('qwen3.6-27b'));
    assert.ok(aliases.includes('qwen3.6-35b'));
    assert.ok(aliases.includes('magistral'));
    assert.ok(aliases.includes('devstral-small-2'));
    assert.ok(aliases.includes('ministral-3-14b'));
    assert.ok(!aliases.some((a) => /kimi|mimo/i.test(a)));
    assert.equal(getCatalogModel('gpt-oss:120b')?.alias, 'gpt-oss-120b');
    assert.equal(getCatalogModel('magistral')?.thinkingApi, 'boolean');
    assert.equal(getCatalogModel('codestral')?.thinkingApi, 'none');
  });

  it('merges catalog ahead of a stale remote list', () => {
    const merged = mergePickerModels([
      { id: 'spockify-auto', label: 'auto' },
      { id: 'codestral' },
      { id: 'kimi-k2.5:cloud' },
      { id: 'extra-local' },
    ]);
    const ids = merged.map((m) => m.id);
    assert.equal(ids[0], AUTO_MODEL_ID);
    assert.ok(ids.includes('gemma4-31b'));
    assert.ok(ids.includes('gpt-oss-120b'));
    assert.ok(ids.includes('extra-local'));
    assert.ok(!ids.includes('kimi-k2.5:cloud'));
    assert.equal(merged.filter((m) => m.id === 'codestral').length, 1);
  });

  it('denies Kimi cloud and MiMo', () => {
    assert.equal(isDeniedPickerId('kimi-k2.5:cloud'), true);
    assert.equal(isDeniedPickerId('mimo-v2.5'), true);
    assert.equal(isDeniedPickerId('gpt-oss-120b'), false);
  });
});
