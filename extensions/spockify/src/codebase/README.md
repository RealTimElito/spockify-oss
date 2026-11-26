# Spockify `@codebase` (WS-CLONE-G)

Local BM25 index over workspace files for `@codebase` / `@folder` retrieval (BUILD_PLAN §6.6).

## Layout

| File | Role |
|------|------|
| `types.ts` | `CodebaseContextProvider` contract for chat/composer |
| `workspaceFs.ts` | Scheme-aware `vscode.workspace.fs` adapter (local + Remote SSH ui-kind) |
| `provider.ts` | Index build/search + incremental upsert |
| `register.ts` | Commands, folder-open index, debounced reindex on save |

Core indexing lives in `packages/spockify-codebase` (chunker, ignore-aware crawl, JSON store).

**Remote SSH:** extension is `ui`-kind — crawl uses `vscode.Uri.joinPath(folder, …)` (not `Uri.file`) so reads hit the remote FS.

## Commands

- **Spockify: Reindex Codebase** — `spockify.codebase.reindex`
- **Spockify: Search Codebase** — `spockify.codebase.search` (prints hits to **Spockify Codebase** output)

## Settings (`spockify.codebase.*`)

- `indexOnStartup` — build/load index when the extension activates (default `true`)
- **`autoAttach`** — inject hybrid search hits into Chat/Composer turns automatically (default `true`). Without this, the index is unused unless the user clicks **@codebase**.
- `autoAttachAsk` — also auto-attach in Ask mode (default `true`)
- `reindexOnSave` — debounced full reindex after save (default `true`)
- `reindexDebounceMs` — debounce delay (default `1500`)
- `chunkMaxLines` / `chunkOverlapLines` — chunking
- `maxFileBytes` — skip large files
- `searchTopK` — default hit count for the search command
- `hybrid` — BM25 + remote embeddings when signed in (default `true`)
- `embedModel` — default `nomic-embed` via spockify.eu
- `remoteIndexMeta` — push fingerprint/counts to `/api/v1/spockify/ide/index` after reindex (default `true`; never uploads chunk text/vectors)

**Remote vector/chunk sync** is intentionally not implemented — metadata only on spockify.eu. Local hybrid (Lance flat + IVF when native + nomic embeds) is the retrieval path.

Status bar shows chunk/file counts while ready, live file progress while indexing, `·emb` when remote embed model is active, and `·lance` / `·ivf` when the Lance companion is present. Output channel **Spockify Codebase** logs crawl progress.

## Ignore rules

`.gitignore` and `.spockifyignore` at the workspace root, plus built-in skips (`node_modules`, binaries, etc.).

## Integration

```ts
import { registerCodebase } from './codebase';

const codebase = registerCodebase(context, { output });
// codebase.search({ query: '...', k: 8 })
```

Index JSON is stored under the extension global storage URI (`codebase/<hash>.json`).
