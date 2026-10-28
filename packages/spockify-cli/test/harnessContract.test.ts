import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_HARNESS_EXPORTS,
  REQUIRED_HARNESS_HOST_EXPORTS,
  assertCliPackages,
} from '../src/harnessContract';

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Value imports only. `import type` and inline `type Name` are skipped. */
function runtimeImports(pkg: string): string[] {
  const names = new Set<string>();
  const re = new RegExp(
    `(?:import|export)\\s+(type\\s+)?\\{([^{}]*)\\}\\s+from\\s+['"]${pkg}['"]`,
    'g',
  );
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  for (const file of walkTs(src)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(re)) {
      if (match[1]) continue;
      for (const part of match[2].split(',')) {
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith('type ')) continue;
        const name = trimmed.split(/\s+as\s+/)[0]?.trim();
        if (name) names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe('CLI harness contract', () => {
  it('lists every runtime import from the linked packages', () => {
    assert.deepEqual(
      [...REQUIRED_HARNESS_EXPORTS].sort(),
      runtimeImports('@spockify/harness'),
    );
    assert.deepEqual(
      [...REQUIRED_HARNESS_HOST_EXPORTS].sort(),
      runtimeImports('@spockify/harness-host'),
    );
  });

  it('loads those exports from the built packages', () => {
    assert.doesNotThrow(() => assertCliPackages());
  });
});
