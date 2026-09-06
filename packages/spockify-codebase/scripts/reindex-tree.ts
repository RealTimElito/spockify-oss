/**
 * Full-tree (ignore-aware) reindex smoke for agentHub.
 * Proves crawl → Lance companion at monorepo scale (see root `.spockifyignore`).
 *
 * Usage: npx tsx scripts/reindex-tree.ts [root]
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildIndex,
  saveIndex,
  createNodeFs,
  companionLancePath,
  hasLanceStore,
  lanceDbAvailable,
  IVF_MIN_ROWS,
} from '../src/index';

async function main(): Promise<void> {
  const root = path.resolve(
    process.argv[2] || path.join(__dirname, '../../..'),
  );
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-reindex-'));
  const indexPath = path.join(outDir, 'agentHub.json');

  const started = Date.now();
  const index = await buildIndex(root, createNodeFs(), {
    maxFileBytes: 512_000,
  });
  await saveIndex(indexPath, index);
  const elapsed = Date.now() - started;

  const lanceMetaPath = path.join(companionLancePath(indexPath), 'meta.json');
  let lanceMeta: Record<string, unknown> | undefined;
  if (await hasLanceStore(indexPath)) {
    lanceMeta = JSON.parse(await fs.readFile(lanceMetaPath, 'utf8'));
  }

  const report = {
    root,
    chunks: index.chunks.length,
    docCount: index.docCount,
    vectors: Object.keys(index.vectors || {}).length,
    embedModel: index.embedModel,
    elapsedMs: elapsed,
    lanceDbAvailable: lanceDbAvailable(),
    lance: lanceMeta
      ? {
          count: lanceMeta.count,
          dim: lanceMeta.dim,
          backend: lanceMeta.backend,
          annIndex: lanceMeta.annIndex,
          ivfEligible: Number(lanceMeta.count) >= IVF_MIN_ROWS,
        }
      : null,
    indexPath,
  };
  console.log(JSON.stringify(report, null, 2));

  if (index.chunks.length < 50) {
    console.error(
      'Expected a fuller tree (≥50 chunks); check ignore rules / root',
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
