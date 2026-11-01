/**
 * G4 promoted-model deck vs catalog. No cloud tags. Auto stays spockify-auto.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CODING_CATALOG_V1,
  codingPickerItems,
  isAutoModelId,
  promotedCodingIds,
  unpublishedLabModels,
} from '../src/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type DeckRow = {
  id: string;
  promoted: boolean;
  pool: string;
  auto_eligible: boolean;
  think_allowed: string[];
  tools: boolean;
  stream: boolean;
  context: string;
  num_ctx?: number;
  num_ctx_source?: string;
};

type Deck = {
  auto: string;
  promoted: DeckRow[];
  lab_only: DeckRow[];
};

describe('G4 promoted-model deck', () => {
  const deck = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'catalog/promoted-deck.v1.json'), 'utf8'),
  ) as Deck;

  it('Auto is spockify-auto and picker leads with it', () => {
    assert.equal(deck.auto, 'spockify-auto');
    assert.equal(isAutoModelId(deck.auto), true);
    assert.equal(codingPickerItems()[0]?.id, 'spockify-auto');
  });

  it('promoted ids match the coding catalog and have tools+stream', () => {
    assert.deepEqual(
      deck.promoted.map((r) => r.id).sort(),
      promotedCodingIds().sort(),
    );
    for (const row of deck.promoted) {
      const cat = CODING_CATALOG_V1.models.find((m) => m.id === row.id);
      assert.ok(cat, row.id);
      assert.equal(row.promoted, true);
      assert.equal(cat?.promoted, true);
      assert.deepEqual(row.think_allowed, cat?.think_allowed);
      assert.equal(row.tools, true);
      assert.equal(row.stream, true);
      assert.match(row.context, /^(131072|262144)$/);
      assert.equal(String(row.num_ctx), row.context);
      assert.ok((row.num_ctx_source || '').length > 8);
      assert.ok(!row.think_allowed.includes('heavy'));
      assert.ok(!/cloud|:cloud/i.test(row.id));
    }
    assert.equal(
      deck.promoted.find((r) => r.id === 'qwen3.8-flash-next-ud-UD-Q3_K_XL')
        ?.auto_eligible,
      false,
    );
    assert.equal(
      deck.promoted.find((r) => r.id === 'gpt-oss-20b')?.auto_eligible,
      true,
    );
  });

  it('lab-only rows stay unpublished and Auto-ineligible', () => {
    assert.deepEqual(
      deck.lab_only.map((r) => r.id),
      unpublishedLabModels().map((r) => r.id),
    );
    for (const row of deck.lab_only) {
      assert.equal(row.promoted, false);
      assert.equal(row.auto_eligible, false);
      assert.equal(row.context, 'not-pinned');
      assert.equal(row.num_ctx, undefined);
      assert.ok(!/cloud|:cloud/i.test(row.id));
    }
  });

  it('model ids contain no cloud tags', () => {
    const ids = [
      deck.auto,
      ...deck.promoted.map((r) => r.id),
      ...deck.lab_only.map((r) => r.id),
      ...CODING_CATALOG_V1.models.map((m) => m.id),
      ...CODING_CATALOG_V1.lab_models.map((m) => m.id),
    ];
    for (const id of ids) {
      assert.doesNotMatch(id, /:cloud/i);
      assert.doesNotMatch(id, /^cloud-/i);
    }
  });
});
