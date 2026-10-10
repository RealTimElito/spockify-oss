import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CODING_CATALOG_V1,
  filterToCodingPins,
  codingPickerItems,
  formatLabModelMissingError,
  formatSessionPin,
  isLabCatalogId,
  isProdCodingPin,
  isPublicProdHost,
  isSelectableCodingId,
  isWriteTool,
  matchLabUpstreamId,
  modelAcceptsThinkFlag,
  pickSkillsByName,
  pinModelAfterWrite,
  promoteLabModelHint,
  promotedCodingIds,
  resolveUpstreamModelId,
  thinkingRequestFields,
  unpublishedLabModels,
} from '../src/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('coding catalog v1', () => {
  it('JSON matches TS and lists only prod 20b/120b pins', () => {
    const jsonPath = path.join(ROOT, 'catalog/coding-models.v1.json');
    const file = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as typeof CODING_CATALOG_V1;
    assert.deepEqual(file, CODING_CATALOG_V1);
    assert.deepEqual(promotedCodingIds().sort(), ['gpt-oss-120b', 'gpt-oss-20b']);
    assert.equal(
      CODING_CATALOG_V1.models.filter((m) => m.id === 'gpt-oss-20b').length,
      1,
    );
    assert.ok(
      [...CODING_CATALOG_V1.models, ...CODING_CATALOG_V1.lab_models].every(
        (m) => !m.think_allowed.includes('heavy'),
      ),
    );
    assert.equal(CODING_CATALOG_V1.lab_models.length, 3);
    const lab = unpublishedLabModels();
    assert.deepEqual(
      lab.map((r) => r.id),
      ['devstral-small-2', 'devstral-2', 'qwen3-coder-30b-a3b'],
    );
    assert.ok(lab.every((r) => r.promoted === false));
    assert.equal(lab.find((r) => r.id === 'qwen3-coder-30b-a3b')?.pool, 'eval');
    assert.equal(
      lab.find((r) => r.id === 'qwen3-coder-30b-a3b')?.ollama_tag,
      'qwen3-coder:30b-a3b-q4_K_M',
    );
    const ids = CODING_CATALOG_V1.models.map((m) => m.id).join(' ');
    assert.ok(!/qwen|devstral|glm|deepseek/i.test(ids));
    assert.equal(isProdCodingPin('qwen3-coder-30b-a3b'), false);
    assert.equal(isProdCodingPin('devstral-2'), false);
    const pins = filterToCodingPins([
      { id: 'gpt-oss-20b' },
      { id: 'qwen3-coder-30b-a3b' },
      { id: 'devstral-2' },
      { id: 'codestral' },
      { id: 'gpt-oss-120b' },
    ]);
    assert.deepEqual(
      pins.map((p) => p.id),
      ['gpt-oss-20b', 'gpt-oss-120b'],
    );
    assert.match(promoteLabModelHint(), /no-op until a fixture CARD/);
    assert.equal(isLabCatalogId('devstral-2'), true);
    assert.equal(isLabCatalogId('qwen3-coder-30b-a3b'), true);
    assert.equal(isLabCatalogId('gpt-oss-20b'), false);
    assert.equal(isSelectableCodingId('qwen3-coder-30b-a3b'), true);
    assert.equal(isSelectableCodingId('spockify-auto'), true);
    assert.equal(isSelectableCodingId('codestral'), false);
    const picker = codingPickerItems();
    assert.deepEqual(
      picker.map((p) => p.id),
      [
        'spockify-auto',
        'gpt-oss-20b',
        'gpt-oss-120b',
        'devstral-small-2',
        'devstral-2',
        'qwen3-coder-30b-a3b',
      ],
    );
    assert.ok(picker.filter((p) => p.section === 'lab').every((p) => p.id));
  });

  it('formats session pin HUD', () => {
    assert.equal(
      formatSessionPin({
        harnessId: 'spockify',
        model: 'gpt-oss-20b',
        thinking: 'low',
      }),
      'harness=spockify · gpt-oss-20b · think=low',
    );
    assert.match(
      formatSessionPin({
        harnessId: 'spockify',
        model: 'devstral-2',
        thinking: 'off',
      }),
      /devstral-2 · think=off · evicts 120b-hot/,
    );
    assert.equal(
      formatSessionPin({
        harnessId: 'spockify',
        model: 'devstral-small-2',
        thinking: 'off',
      }),
      'harness=spockify · devstral-small-2 · think=off',
    );
    assert.match(
      formatSessionPin({
        harnessId: 'spockify',
        model: 'gpt-oss-20b',
        thinking: 'off',
        auto: true,
      }),
      /auto → gpt-oss-20b think=off/,
    );
  });

  it('locks Auto to the resolved worker after a write', () => {
    assert.equal(isWriteTool('apply_patch'), true);
    assert.equal(isWriteTool('read_file'), false);
    assert.equal(pinModelAfterWrite('spockify-auto', 'gpt-oss-20b'), 'gpt-oss-20b');
    assert.equal(pinModelAfterWrite('gpt-oss-20b', 'gpt-oss-120b'), 'gpt-oss-20b');
  });

  it('attaches at most two skills by name', () => {
    const all = [
      { id: 'foo', title: 'Foo', path: 'foo.md', body: 'A' },
      { id: 'bar', title: 'Bar', path: 'bar.md', body: 'B' },
      { id: 'baz', title: 'Baz', path: 'baz.md', body: 'C' },
    ];
    const picked = pickSkillsByName(all, ['foo', 'bar', 'baz']);
    assert.equal(picked.length, 2);
    assert.deepEqual(
      picked.map((s) => s.id),
      ['foo', 'bar'],
    );
  });

  it('maps qwen catalog id to the eval Ollama tag and omits think', () => {
    assert.equal(
      resolveUpstreamModelId('qwen3-coder-30b-a3b'),
      'qwen3-coder:30b-a3b-q4_K_M',
    );
    assert.equal(
      matchLabUpstreamId('qwen3-coder-30b-a3b', [
        'gpt-oss-20b',
        'qwen3-coder:30b-a3b-q4_K_M',
      ]),
      'qwen3-coder:30b-a3b-q4_K_M',
    );
    assert.equal(
      matchLabUpstreamId('qwen3-coder-30b-a3b', ['qwen3-coder:30b-a3b-q8_0']),
      'qwen3-coder:30b-a3b-q8_0',
    );
    assert.equal(matchLabUpstreamId('qwen3-coder-30b-a3b', ['gpt-oss-20b']), undefined);
    assert.equal(modelAcceptsThinkFlag('qwen3-coder-30b-a3b'), false);
    assert.equal(modelAcceptsThinkFlag('qwen3-coder:30b-a3b-q4_K_M'), false);
    assert.equal(modelAcceptsThinkFlag('gpt-oss-20b'), true);
    assert.deepEqual(thinkingRequestFields('qwen3-coder-30b-a3b', 'off'), {});
    assert.deepEqual(thinkingRequestFields('qwen3-coder-30b-a3b', 'high'), {});
    assert.deepEqual(thinkingRequestFields('gpt-oss-20b', 'off'), {});
    assert.deepEqual(thinkingRequestFields('gpt-oss-20b', 'high'), {
      spockify_thinking: 'high',
    });
    assert.equal(isPublicProdHost('https://spockify.eu'), true);
    assert.equal(isPublicProdHost('http://127.0.0.1:11434'), false);
    assert.match(
      formatLabModelMissingError('qwen3-coder-30b-a3b', 'https://spockify.eu'),
      /lab model.*spockify\.eu.*11434/s,
    );
  });
});
