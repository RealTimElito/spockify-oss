import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_MODEL_ID,
  catalogAliases,
  getCatalogModel,
  isCodingPickerId,
  isDeniedPickerId,
  mergePickerModels,
} from '../src/chat/modelCatalog';

describe('modelCatalog', () => {
  it('lists Spark chat aliases (no Kimi / MiMo)', () => {
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
    assert.ok(aliases.includes('devstral-2'));
    assert.ok(aliases.includes('ministral-3-14b'));
    assert.ok(!aliases.some((a) => /kimi|mimo/i.test(a)));
    assert.equal(getCatalogModel('gpt-oss:120b')?.alias, 'gpt-oss-120b');
    assert.equal(getCatalogModel('magistral')?.thinkingApi, 'boolean');
    assert.equal(getCatalogModel('codestral')?.thinkingApi, 'none');
  });

  it('merges coding catalog by default (IDE picker)', () => {
    const merged = mergePickerModels([
      { id: 'spockify-auto', label: 'auto' },
      { id: 'codestral' },
      { id: 'kimi-k2.5:cloud' },
      { id: 'gemma4-31b' },
      { id: 'nomic-embed' },
      { id: 'llama3.2-3b-cpu' },
      { id: 'llava-7b' },
      { id: 'codellama-13b' },
      { id: 'extra-local' },
    ]);
    const ids = merged.map((m) => m.id);
    assert.equal(ids[0], AUTO_MODEL_ID);
    assert.ok(ids.includes('gpt-oss-120b'));
    assert.ok(ids.includes('codestral'));
    assert.ok(ids.includes('qwen3.6-coder-27b'));
    assert.ok(ids.includes('devstral-2'));
    assert.ok(ids.includes('mathstral'));
    assert.ok(ids.includes('codellama-13b'));
    assert.ok(!ids.includes('gemma4-31b'));
    assert.ok(!ids.includes('nomic-embed'));
    assert.ok(!ids.includes('llama3.2-3b-cpu'));
    assert.ok(!ids.includes('llava-7b'));
    assert.ok(!ids.includes('extra-local'));
    assert.ok(!ids.includes('kimi-k2.5:cloud'));
    assert.equal(merged.filter((m) => m.id === 'codestral').length, 1);
  });

  it('can merge full chat catalog when codingOnly=false', () => {
    const merged = mergePickerModels(
      [
        { id: 'spockify-auto', label: 'auto' },
        { id: 'codestral' },
        { id: 'kimi-k2.5:cloud' },
        { id: 'extra-local' },
      ],
      { codingOnly: false },
    );
    const ids = merged.map((m) => m.id);
    assert.equal(ids[0], AUTO_MODEL_ID);
    assert.ok(ids.includes('gemma4-31b'));
    assert.ok(ids.includes('gpt-oss-120b'));
    assert.ok(ids.includes('extra-local'));
    assert.ok(!ids.includes('kimi-k2.5:cloud'));
    assert.equal(merged.filter((m) => m.id === 'codestral').length, 1);
  });

  it('classifies coding vs non-coding ids', () => {
    assert.equal(isCodingPickerId('spockify-auto'), true);
    assert.equal(isCodingPickerId('codestral'), true);
    assert.equal(isCodingPickerId('gpt-oss-120b'), true);
    assert.equal(isCodingPickerId('gpt-oss:20b'), true);
    assert.equal(isCodingPickerId('qwen3.6-coder-27b'), true);
    assert.equal(isCodingPickerId('devstral-small-2'), true);
    assert.equal(isCodingPickerId('mathstral'), true);
    assert.equal(isCodingPickerId('web-codestral'), true);
    assert.equal(isCodingPickerId('spockify-room'), true);
    assert.equal(isCodingPickerId('nomic-embed'), false);
    assert.equal(isCodingPickerId('llava-7b'), false);
    assert.equal(isCodingPickerId('llama3.2-3b'), false);
    assert.equal(isCodingPickerId('gemma4-31b'), false);
    assert.equal(isCodingPickerId('web-gemma'), false);
    assert.equal(isCodingPickerId('magistral'), false);
    // Lab twin dual-role aliases (lab-orchestrator would otherwise hit CODING_DENY_RE)
    assert.equal(isCodingPickerId('lab-orchestrator'), true);
    assert.equal(isCodingPickerId('lab-executor'), true);
    assert.equal(isCodingPickerId('lab-plan'), true);
    assert.equal(isCodingPickerId('lab-code'), true);
  });

  it('denies Kimi cloud and MiMo', () => {
    assert.equal(isDeniedPickerId('kimi-k2.5:cloud'), true);
    assert.equal(isDeniedPickerId('mimo-v2.5'), true);
    assert.equal(isDeniedPickerId('gpt-oss-120b'), false);
  });
});
