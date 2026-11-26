import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_SPOCKIFY,
  listHarnesses,
  resolveHarnessOrFallback,
  commandDigest,
} from '../src/index';

describe('harness-host', () => {
  it('always includes spockify default', () => {
    const list = listHarnesses();
    assert.ok(list.some((h) => h.id === 'spockify'));
    assert.equal(DEFAULT_SPOCKIFY.id, 'spockify');
  });

  it('falls back when id unknown', () => {
    const r = resolveHarnessOrFallback('no-such-harness-xyz');
    assert.equal(r.harness.id, 'spockify');
    assert.ok(r.fallbackReason);
  });

  it('missing plugin command falls back without hanging', () => {
    const prev = process.env.SPOCKIFY_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-home-'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-proj-'));
    process.env.SPOCKIFY_HOME = home;
    try {
      fs.mkdirSync(path.join(home, 'harnesses'), { recursive: true });
      fs.writeFileSync(
        path.join(home, 'harnesses', 'gone.yaml'),
        'id: gone\ncommand: /no/such/spockify-plugin-bin\n',
      );
      fs.mkdirSync(path.join(root, '.spockify'), { recursive: true });
      fs.writeFileSync(path.join(root, '.spockify', 'harness.yaml'), 'id: gone\n');
      const r = resolveHarnessOrFallback(undefined, root);
      assert.equal(r.harness.id, 'spockify');
      assert.match(r.fallbackReason || '', /not found/);
      assert.equal(r.wanted, 'gone');
    } finally {
      if (prev === undefined) delete process.env.SPOCKIFY_HOME;
      else process.env.SPOCKIFY_HOME = prev;
    }
  });

  it('command digest is stable', () => {
    assert.equal(commandDigest(DEFAULT_SPOCKIFY).length, 12);
  });
});
