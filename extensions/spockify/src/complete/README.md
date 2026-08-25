# Tab complete (ghost text)

## Behavior (0.8.36+)

- **Instant local heuristics** (no debounce): missing commas, sequential numbers, bracket closers, `print(`/`console.log(` stubs
- Base debounce (`spockify.completions.debounceMs`, default **30ms**) with **adaptive** scaling (≈20–80ms): faster after newline/punctuation, slower mid-identifier
- **Speculative** early fire (`completions.speculative`, default on): cancel stale in-flight immediately; do not wait for prior HTTP
- Supersedes in-flight via generation counter + **AbortController** + VS Code cancellation token; keeps last good ghost on cancel
- **Warm on startup** (`completions.warmOnStartup`): tiny Ghost complete ping so gpt-oss-20b stays hot
- Server uses **gpt-oss-20b** + `max_tokens=48` for complete (reactive FIM — not 120b)
- **Context**: FIM prefix/suffix ≈ **4000/1200** chars of the current file; when the cursor is deep, also sends a small **FILE_HEAD** (imports) + **OPEN_TABS** names — not the whole repo / no LSP dump

## Protocol v2 (0.9.7+)

All new request fields are optional server-side; v1 routers ignore them.

- **`diff_history`** (`diffHistory.ts` + `diffTrail.ts`): per-file recent-edit trails as small unified diffs, coalesced after ~1s idle per file; last ≤10 diffs across the ≤5 most recently edited files, ≤2000 chars per request. Collected continuously — snapshot at request time is in-memory only.
- **`context_items`** (`retrievalCache.ts`): ≤3 hits (≤1500 chars) from the local LanceDB/hybrid index, cached per cursor region and refreshed in the background; a cold cache waits ≤50ms, never longer.
- **`linter_errors`** (`linterContext.ts`): errors/warnings for the current file nearest the cursor first, ≤600 chars, from `vscode.languages.getDiagnostics`.
- **`request_id` / `trigger` / `workspace_id` / `rel_path` / `cursor_col`**: set per request in `inlineCompletion.ts`.
- **EDIT rendering** (`editRender.ts`): `mode: "edit"` responses render as a replace-range ghost when the edit collapses to the cursor line (stable-API limit); otherwise fall back to `insert_text` or drop.
- **Fate reporting** (`fate.ts`): accepted / partial / rejected / ignored per `request_id` → fire-and-forget POST `/ghost/fate`, with `settled_text` captured ~1.5s later. Gate: `spockify.completions.telemetry` (default on).

## Coding vs ghost models

| Role | Model | Why |
|------|-------|-----|
| Ghost Tab | **gpt-oss-20b** | Low TTFT, always warm |
| Agent / Auto coding | **gpt-oss-120b** | Quality; fits hot on a large-memory host with 20b + smalls |

## Smoke

1. Open a TS/JSON-ish object with `a: 8100,` … `overwater: |` — ghost should show `8108` instantly (Output: `tab-complete local reason=seq-number-*`).
2. Type `console.log(` — ghost `)` without network wait.
3. Mid-identifier pause ~30–80ms then LLM ghost; Output shows `mode=remote` / `gpt-oss-20b`, `pfx=`/`ctx=` sizes, and latency ms.
4. Deep in a large file: Output `ctx=` > 0 (FILE_HEAD imports present).
5. Rapid typing: no stampede; prior ghost may linger via last-insert until superseded.
6. On IDE start, Output may show `tab-complete warm ok=…`.
7. If `spockify.completions.enabled` is false, no ghosts.
8. Auth/network failures show a **warning toast** (not only Output). On 401 the extension clears the stale token and offers **Sign in**. Check Output → Spockify for `tab-complete error (suggest):` / `tab-complete skipped: not signed in`.
9. After an Open WebUI restart/restore: **Sign out → Email & password** again (stored JWT may be invalid while the status bar still looked signed in).
