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

Doer (build/agent): a final turn with zero tools and no structured `done` / `blocked` line gets **one** continue inject, then the loop stops.

Mid-think coding spawn: parent must emit structured `SPAWN_CODING:[…]` or a `task` tool call (no prompt stanza). Default cap **1** child (canary path); compose may set `SPOCKIFY_CODING_SPAWN_MAX=2` later. One round per user turn. Children cannot nest. Hard child timeout → `blocked:timeout` digest. Off with `SPOCKIFY_CODING_SPAWN=0`. Chat SPAWN stays on the router; do not import `midthought_spawn.py`.

Session pin: CLI header and IDE badge show `harness=<id> · <tag> · think=<level>`, or `auto → <tag> think=<level>` after the session picker. Usage: [`docs/CODING_MODELS.md`](CODING_MODELS.md).

Session-start picker (`pickSessionModel` in `@spockify/harness`): once per Agent/build session, **before tools**. Returns `{model, think}` only — no shell, no workspace tools. Default **20b think=off**. Auto may call a tool-less LiteLLM recommend; if the call fails, keep the default (never keyword-route). Auto may only choose `gpt-oss-20b` / `gpt-oss-120b` — never `pool: lab` or unpublished lab ids (`devstral-small-2`, `devstral-2`, `qwen3-coder-30b-a3b`). User `--model` skips the picker. After the first write, Auto cannot swap the worker. Attach ≤2 skills by name. Task children inherit the parent model tag.

Coding dropdown is the **same** picker: prod 20b/120b plus a **Lab models** section (`promoted: false`). Pin with `--model <id>` or the dropdown. `spockify model lab` lists candidates only. One `spockify` binary — do not treat `spockify lab` as the path to Devstral/Qwen. `devstral-2` warns evicts 120b-hot. Qwen canonical is Instruct Q4/Q8, not fp16. Do not promote lab rows to prod without a fixture CARD. No DeepSeek orch.

Heavy ensemble is **not** a coding harness (see `docs/BENCH.md`). Chat mid-thought SPAWN stays on the router (`docs/MIDTHOUGHT_SPAWN.md`).

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
| userPinnedThink | false | Auto keeps this think level instead of the picker's |

## Tools (Phase 0+)

read / read_file, grep, glob / glob_file_search, apply_patch (SEARCH/REPLACE only), shell / bash, run_tests (fail-object), git_snapshot / git_reset, todowrite, write_file (READ_REQUIRED), edit_file.

## Eval honesty

Until Phase 5 scored path lands on this kernel, `spockify bench swe` may still wrap mini-SWE-agent. Do not claim harness wins in `BENCHMARK_COMPARISON.md` without a `@spockify/harness` commit SHA on the card. OpenCode-parity OC-009+ published rows must call `runHarness` once Phase 5 starts. Phase 5 stays **Partial**. Product chat/router images stay pinned for this catalog/picker work.

Agentic pentest-eval console (`spockify pentest-eval`), skill drop-in paths, and operator flags: [`docs/PENTEST_EVAL.md`](PENTEST_EVAL.md).

Keep the historical Lite `sqlfluff__sqlfluff-1625` / gpt-oss-20b **pass@1 = 0** (~56 min) row; do not delete or retune prompts to flip it.

## Tracking (open)

- Pluggable harness profile v0 — see `docs/HARNESS_PROFILE.md` (default remains `runHarness`):
  - **P0** Done — this profile doc + `packages/spockify-harness/schema/harness-event.v0.json` (matches `HarnessEvent`)
  - **P1** Done — `@spockify/harness-host` stdio JSONL; `spockify --harness spockify` unchanged default
  - **P2** Done — `spockify harness list | test | use`; test cards include harness id
  - **P3** Done — optional `@spockify/harness-adapter-external` only (not under `services/`, not a compose dep)
  - **P4** Done — lab, CLI, and IDE read the same harness yaml (`~/.spockify/harnesses/<id>.yaml`, project `.spockify/harness.yaml`, `spockify harness use`). Session/lab HUD shows the harness id. Missing or broken plugin command errors and falls back to the Spockify kernel (`lab-kernel-stdio` / `runHarness`); yaml is opt-in and the default stays kernel.
- Scored SWE-Lite / Verified on `@spockify/harness` (not mini-SWE wrapper)
- MCP tool proxy via `@spockify/mcp`

## Tracking (done — do not re-open without a failing test)

- Edit cascade L0–L4 (`editCascade.ts` + `editCascade.test.ts` + ws_cascade fixture)
- WRITE guard READ_REQUIRED with last K=3 read window
- Session grants + `/revoke` (`PermissionMemory`)
- Kill registry, task cascade, loop detect, atomic compact rollback
- IDE `agentLoop` → `runHarness` (private body archived under `_archive/`)
- Lab default exec on `runHarness` via stdio; tip-50 tools archived (`SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS=1` only)
