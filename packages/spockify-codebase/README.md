# @spockify/codebase

Local chunk → BM25 + hybrid (BM25 ⊕ embeddings via RRF) index for Spockify IDE `@codebase`.

## Retrieval

| Leg | Source |
|-----|--------|
| Lexical | In-memory BM25 over chunks |
| Dense | Vectors in index (`hash-local` offline, or remote `nomic-embed` via ide-client → spockify.eu → cluster) |
| Fuse | **Min-max normalized score fusion** (default 40% BM25 / 60% vector) — not pure RRF, so semantic hits can beat exclusive keyword matches |

On full reindex (and per-file incremental save), the IDE batches remote embeds when signed in; otherwise hash vectors remain.

## Durable store

`saveIndex` / `loadIndex`:

1. Always write portable `*.json` (chunks + BM25 + vectors).
2. When Node `node:sqlite` is available, also write a companion `*.sqlite` (chunks + Float32 BLOBs + optional FTS5). Load prefers SQLite when present.
3. Always write a dedicated Lance-class companion `*.lance/` (flat float32 matrix + `chunks.json` meta + meta). When `@lancedb/lancedb` native loads, also write a real Lance table and use it for ANN vector search. **Electron hosts** still get real path/text hits from flat `chunks.json` (no `__chunk__:` stubs).
4. **Large-repo IVF:** when LanceDB loads and row count ≥ `IVF_MIN_ROWS` (256), build `IVF_PQ` (dim divisible by 8) or `IVF_FLAT` ANN index; meta records `annIndex`.
5. **Prefer ANN seed:** when chunk count ≥ `ANN_PREFER_MIN_ROWS` (128) and Lance ANN returns hits, hybrid skips O(n) in-memory vector scan and fuses BM25 + ANN seed (large-repo / AppImage path).

**Cloud vector sync:** deferred — Cluster only stores **index metadata** (`/api/v1/spockify/ide/index`). Uploading chunk text / embedding matrices overnight was judged too risky for web (size, storage, RollingUpdate blast radius). Local Lance + nomic remains source of truth.

Full-tree smoke: `npx tsx scripts/reindex-tree.ts /path/to/agentHub` (respects `.gitignore` / `.spockifyignore`).

Live embed proof: `SPOCKIFY_API_KEY=… npm test -- test/live-nomic-hybrid.test.ts` (skips when unset).

## Proved hybrid > BM25 (fixture)

See `test/hybrid.test.ts` — **“hybrid beats BM25-only on synonym query”**:

- Query: `sign-in session credentials`
- BM25 ranks `ui/session.tsx` first (token overlap on `session`)
- Controlled embed places the query in the auth cluster → hybrid ranks `auth/login.ts` first

That is the documented semantic win for Phase 3 DoD (local/controlled embed). Production path uses remote `nomic-embed` when auth + `/v1/embeddings` succeed; otherwise hash-vector fallback (still hybrid fused, weaker semantics).

## Ignore

`.gitignore` + `.spockifyignore` via `IgnoreMatcher`.

## SSH / remote workspaces

Indexing uses the VS Code workspace FS adapter (`createWorkspaceFs`). On Remote SSH, `file` scheme folders under the remote root are indexed on the remote machine's view of the FS. Limitations:

- Global storage for the JSON/SQLite index still lives on the **local** extension host machine (per VS Code remote architecture).
- Large remote monorepos: prefer `spockify.codebase.maxFileBytes` and `.spockifyignore` to keep latency down.
- Remote embed calls still go **local IDE → spockify.eu → cluster** (not via the SSH host).
