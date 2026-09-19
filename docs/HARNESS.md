# Spockify harness kernel

Shared coding-agent loop for CLI, IDE, and lab. Extracted from `packages/spockify-cli/src/agent/*` per harness plan Phase 0.

## Phases (status 2026-09-19)

| Phase | Status |
|-------|--------|
| 0 Extract | Done |
| 1 Control | Done — parallel, kill, task, replay, compact tests |
| 2 Beat gaps | Done — cascade L0–L4, READ_REQUIRED (last K=3), session grants/revoke |
| 3 Extensibility | Done — skills, hooks, napkin; MCP stays `@spockify/mcp` |
| 4 Unify clients | Done — CLI + IDE →`runHarness`; lab default exec via `lab-kernel-stdio` / `kernel_bridge`; tip-50 `apply_writes`/`run_shell` under `_archive/tip50/` behind `SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS=1` only; `check_harness_clients.sh` GREEN |
| 5 Eval | Partial — `spockify bench kernel` unit/mock OK; scored SWE still mini-SWE while Lite board runs |

## Decision record

**The router never executes workspace tools.** `services/router` picks models, runs Heavy chat workers, and grounds search. File/shell/task tools live only in `@spockify/harness` (and IDE apply UX that consumes the same event stream). A PR that adds `read_file` / `shell` execution inside the router is rejected.

Heavy ensemble is **not** a coding harness (see `docs/BENCH.md`).

Phase 4 gate: `scripts/bench/check_harness_clients.sh` must print `PHASE4-GREEN: single loop body in packages/spockify-harness`.

## API

```ts
import { runHarness, ToolRegistry, registerHarnessTools } from '@spockify/harness';

for await (const ev of runHarness({
  transport,
  session,
  registry,
  policy: { mode: 'build', maxTurns: 48 },
  signal,
})) {
  // status | model | text | thinking | toolStart | toolResult | toolKilled |
  // loopWarning | compact | taskSpawn | taskDone | askUser | done | error
}
```

`runAgentTurn` remains for CLI REPL compatibility; it is the same loop.

## Policy fields

| Field | Defaults | Notes |
|-------|----------|-------|
| mode | ask \| agent \| plan \| build | plan≈ask; build≈agent |
| maxTurns | 12 / 48 / 80 | Hard cap 80 |
| parallelTools | true | Phase 1; `--seq-exec` → false |
| loopWindow / loopThreshold | 20 / 5 | Identical tool signature window |
| writeRequiresRead | true | Off only yolo + explicit flag; last K=3 reads |
| editCascade | true | L0 exact → L1 ws-norm → L2 anchors → L3 hunk → L4 refuse |
| thinking | off…heavy | Passed to transport; Heavy does not spawn coding workers |

## Tools (Phase 0+)

read / read_file, grep, glob / glob_file_search, apply_patch (SEARCH/REPLACE only), shell / bash, run_tests (fail-object), git_snapshot / git_reset, todowrite, write_file (READ_REQUIRED), edit_file.

## Eval honesty

Until Phase 5 scored path lands on this kernel, `spockify bench swe` may still wrap mini-SWE-agent. Do not claim harness wins in `BENCHMARK_COMPARISON.md` without a `@spockify/harness` commit SHA on the card. OpenCode-parity OC-009+ published rows must call `runHarness` once Phase 5 starts.

Keep the historical Lite `sqlfluff__sqlfluff-1625` / gpt-oss-20b **pass@1 = 0** (~56 min) row; do not delete or retune prompts to flip it.

## Tracking (open)

- Pluggable harness profile v0 — see `docs/HARNESS_PROFILE.md` (default remains `runHarness`):
  - **P0** Done — this profile doc + `packages/spockify-harness/schema/harness-event.v0.json` (matches `HarnessEvent`)
  - **P1** Done — `@spockify/harness-host` stdio JSONL; `spockify --harness spockify` unchanged default
  - **P2** Done — `spockify harness list | test | use`; test cards include harness id
  - **P3** Done — optional `@spockify/harness-adapter-external` only (not under `services/`, not a compose dep)
  - **P4** Partial — IDE session activity badge + CLI `harness:` line read `~/.spockify/harnesses`; lab still always uses the Spockify kernel stdio bridge (no yaml plugin picker yet)
- Scored SWE-Lite / Verified on `@spockify/harness` (not mini-SWE wrapper)
- MCP tool proxy via `@spockify/mcp`

## Tracking (done — do not re-open without a failing test)

- Edit cascade L0–L4 (`editCascade.ts` + `editCascade.test.ts` + ws_cascade fixture)
- WRITE guard READ_REQUIRED with last K=3 read window
- Session grants + `/revoke` (`PermissionMemory`)
- Kill registry, task cascade, loop detect, atomic compact rollback
- IDE `agentLoop` → `runHarness` (private body archived under `_archive/`)
- Lab default exec on `runHarness` via stdio; tip-50 tools archived (`SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS=1` only)
