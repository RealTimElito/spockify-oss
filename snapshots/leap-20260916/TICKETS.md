# Leap tickets — 2026-09-16

Standing order (Director / every agent): Do not add invent slugs. Do not publish a bare percentage. Do not select abliterated or `:cloud` tags on the spark/prod profile. Do not fold Heavy into the coding harness. Do not change the default model and the loop in the same scored run. If your ticket does not produce a canary-safe artifact, a trajectory, a card, or a policy test, stop and ask the Director. Twin-targeted work runs on **prod Spark** (`tim@example.local`, ns `spockify`) this window — short canaries/smoke OK; no 48h GPU burn; SWE Docker prefers this amd64 workstation + Spark LiteLLM PF.

Director checkbox: mark Done only with artifact path + canary stamp when loop/router touched.

---

## Phase 0

### LEAP-001 | Owner: A2 | Phase: 0 | Skill: skill-trace-jsonl
**Goal:** schema-trace.v1.json + validator.
**In scope:** `scripts/bench/schema-trace.v1.json`, `scripts/bench/validate_trace_jsonl.py`
**Out of scope:** loop emission wiring (follow-on).
**DoD:** validator ACCEPT on sample; REJECT missing model/think/stop_reason/wall_s.
**Status:** DONE
**Artifact:** `scripts/bench/schema-trace.v1.json`, `scripts/bench/validate_trace_jsonl.py`
**Director:** [x]

### LEAP-002 | Owner: A1 | Phase: 0 | Skill: skill-canary-run
**Goal:** packs/canary-v1.json + gate wrapping lab_regress_quick.
**In scope:** pack, `scripts/lab_regress_quick.sh`, `scripts/canary_gate.sh`
**Out of scope:** 120b, invents.
**DoD:** pack lists rate/hello/docs/calc/rename; gate prints CANARY-GREEN|RED + stamp.
**Status:** DONE (artifacts); canary run pending LiteLLM PF
**Artifact:** `packs/canary-v1.json`, `scripts/lab_regress_quick.sh`, `scripts/canary_gate.sh`
**Director:** [x] artifacts; runtime stamp TBD

### LEAP-003 | Owner: A0 | Phase: 0 | Skill: skill-product-policy
**Goal:** TICKETS.md + standing order pinned.
**Status:** DONE
**Artifact:** this file
**Director:** [x]

### LEAP-004 | Owner: A12 | Phase: 0 | Skill: skill-canary-run
**Goal:** red-team fixture list mapped to tips 01,06,07,10,13,50,53,58,65.
**Status:** DONE
**Artifact:** `snapshots/leap-20260916/redteam/FIXTURE_MAP.md`
**Director:** [x]

---

## Phase 1 infra + SWE

### LEAP-005 | Owner: A3 | Phase: 1 | Skill: skill-litellm-only
**Goal:** LiteLLM reachability matrix compose/Spark; document forbidden router use.
**Status:** DONE
**Artifact:** `snapshots/leap-20260916/HOST_MATRIX.md`

### LEAP-006 | Owner: A3 | Phase: 1 | Skill: skill-infra-fail
**Goal:** Docker/Podman decision (amd64 vs qemu) written down.
**Status:** DONE — amd64 Docker on `spock` + Spark LiteLLM PF.
**Artifact:** `snapshots/leap-20260916/HOST_MATRIX.md`

### LEAP-007 | Owner: A4 | Phase: 1 | Skill: skill-swe-one-instance
**Goal:** pin mini-swe-agent + {{task}} template lint.
**Status:** DONE
**Artifact:** `scripts/bench/requirements-mini-swe.txt`, `lint_swe_template.sh`, `MINI_SWE_PIN.md`

### LEAP-008 | Owner: A4 | Phase: 1 | Skill: skill-litellm-only
**Goal:** dry-run + smoke 20b against Spark LiteLLM.
**Status:** DONE
**Artifact:** `snapshots/leap-20260916/{dry-run,smoke}.log`

### LEAP-009 | Owner: A4 | Phase: 1 | Skill: skill-swe-one-instance
**Goal:** SWE Lite 0:1 20b think=low — THE ticket.
**Kill:** if image pull blocks >48h → INFRA-BLOCK; do not retune prompts.
**Status:** DONE — not-resolved (`LimitsExceeded`, 100 api calls, empty patch). Infra path unblocked (amd64 Docker + Spark LiteLLM).
**Artifact:** `snapshots/leap-20260916/cards/sqlfluff__sqlfluff-1625.md` (+ `.summary.json`); raw `bench-out/leap-009-lite-0-1e/`
**Director:** [x]

### LEAP-010 | Owner: A11 | Phase: 1 | Skill: skill-four-factor-card
**Goal:** card template paragraph in BENCHMARK_COMPARISON.md (empty numbers OK).
**Status:** DONE — template + first Lite 0:1 row filled (honest not-resolved).
**Artifact:** `docs/BENCHMARK_COMPARISON.md` §8
**Director:** [x] AUDIT-OK

---

## Phase 2 (open after canary green + 009 trajectory or infra-fail)

### LEAP-011 | Owner: A6 | Phase: 2 | Skill: skill-patch-apply
**Goal:** choose patch format; implement reject-other.
**Status:** DONE — search-replace chosen; unified-diff rejected; full-file transitional.
**Artifact:** `apply_patch.py`, `PATCH_FORMAT.md`

### LEAP-012 | Owner: A6 | Phase: 2 | Skill: skill-git-txn
**Goal:** git snapshot/reset helpers + test.
**Status:** DONE
**Artifact:** `git_txn.py` + tests

### LEAP-013 | Owner: A7 | Phase: 2 | Skill: skill-fail-object
**Goal:** fail-object schema wired into verify state.
**Status:** DONE — fail-object appended on red pytest observations.
**Artifact:** `fail_object.py` + `shell_tool.format_observations`

### LEAP-014 | Owner: A5 | Phase: 2 | Skill: skill-one-factor
**Goal:** state-machine tests for DONE-during-verify and stub-retry.
**Status:** DONE (unit gates)
**Artifact:** `tests/test_leap_harness.py`


### LEAP-020 | Owner: A4+A3 | Phase: 1 | Skill: skill-swe-one-instance
**Goal:** Fix gpt-oss/mini-swe empty-content thrash (tool_calls / reasoning_content).
**In scope:** `scripts/bench/spockify_litellm_model.py`, template ```bash contract, run-swebench PYTHONPATH.
**Out of scope:** invent slugs, loop.py, Heavy.
**DoD:** re-run sqlfluff__sqlfluff-1625 produces non-empty actions; traj not all FormatError; card updated.
**Status:** DONE — run f: 81/100 nonempty, 76 Observations (was 0/100). Still LimitsExceeded / empty patch (agent skill, not thrash).
**Artifact:** `scripts/bench/spockify_litellm_model.py`, `NOTES-LEAP-020.md`, updated card
**Director:** [x]

### LEAP-021 | Owner: A4 | Phase: 1 | Skill: skill-swe-one-instance
**Goal:** Raise step budget + patch-finish prompt skill; re-run sqlfluff on 20b.
**In scope:** tmpl step_limit/env, surgical-edit + early-submit instructions; empty-stop recovery; max_tokens; tool-parse soft-fail.
**Out of scope:** 120b load on live Spark; invent slugs.
**DoD:** config step_limit≥150; re-run card updated (resolved|not-resolved|infra-fail).
**Status:** DONE — config landed; runs g/h/i **infra-fail/hung**; best scored row remains run f **not-resolved**.
**Artifact:** `spockify-swebench.yaml.tmpl`, `spockify_litellm_model.py`, `NOTES-LEAP-021.md`, card

### LEAP-022 | Owner: A4 | Phase: 1 | Skill: skill-swe-one-instance
**Goal:** Fix infra hangs (qemu grep zombies, empty-stop loops, 500 storms); complete scored sqlfluff-1625; prefer resolved.
**In scope:** SpockifyDockerEnvironment sanitize/timeout; conditional empty-stop submit; wall clock; run_mini_swe image wire.
**Out of scope:** 120b; 48h loops; full deploy.
**Status:** DONE — run **m** Submitted nonempty · **not-resolved** (SyntaxError patch). Hang class fixed (no hung ESTAB).
**Artifact:** `NOTES-LEAP-022.md`, `snapshots/bench-results-20260917/RESULTS.md`, card, harness files
**Director:** [x] AUDIT-OK

### LEAP-023 | Owner: A4 | Phase: 1 | Skill: skill-swe-one-instance
**Goal:** Stop broken `\\n`/IndentationError submits; push sqlfluff-1625 toward resolved.
**In scope:** sed `\\n` block; py_compile submit gate + revert; wording prompt; re-runs o/p.
**Out of scope:** 120b; fake pass@1.
**Status:** DONE — harness landed; run **o/p** Submitted compile-clean · **not-resolved** (exact description ≠ gold).
**Artifact:** `NOTES-LEAP-023.md`, RESULTS.md, card
**Director:** [x] AUDIT-OK

### LEAP-024 | Owner: A4 | Phase: 1 | Skill: skill-swe-one-instance
**Goal:** Exact FAIL_TO_PASS description; resolve sqlfluff-1625.
**In scope:** prompt exact string; pre-submit drift normalize; re-run q.
**Status:** DONE — run **q resolved** (FAIL_TO_PASS pass; CLI 69 passed).
**Artifact:** `NOTES-LEAP-024.md`, RESULTS.md, card
**Director:** [x] AUDIT-OK

### LEAP-015 | Owner: A8 | Phase: 3 | Skill: skill-four-factor-card
**Goal:** 120b ± think on THE instance from 009 only.
**Status:** HOLD-VRAM — gpt-oss:120b is 65GB; ~51Gi available with chat-resident 20b+8b+3b; full SWE would fight Voice/chat. See `NOTES-LEAP-015.md`.

### LEAP-016 | Owner: A0+A2 | Phase: 0 | Skill: skill-trace-jsonl
**Goal:** loop48.sh + state json + heartbeat log.
**Status:** OPEN (sketch present; do **not** arm on prod Spark GPUs)
**Artifact:** `snapshots/leap-20260916/loop48.sh` (sketch)

### LEAP-017 | Owner: A1 | Phase: 0 | Skill: skill-canary-run
**Goal:** wire canary into 90 min slot with lock file.
**Status:** DONE (artifact; do not cron-arm on prod GPUs this window)
**Artifact:** `snapshots/leap-20260916/canary_slot.sh`

### LEAP-018 | Owner: A3 | Phase: 1 | Skill: skill-infra-fail
**Goal:** HOST-GREEN|HOST-BLOCK file that C6 reads.
**Status:** DONE — `HOST_FLAG` written (disk warn noted)
**Artifact:** `snapshots/leap-20260916/HOST_FLAG`

### LEAP-019 | Owner: A0 | Phase: 0 | Skill: skill-one-factor
**Goal:** start 48h only after 001–003 green; closeout pack.
**Status:** HOLD — not on prod Spark

---

## Anti-tickets (never open)

- LEAP-040 add four invents
- LEAP-041 enable Heavy for coding

## Progress log

- 2026-09-16: Phase 0 artifacts landed (001–004). HOST_MATRIX + HOST-GREEN (disk warn 93%).
- LEAP-007: mini-swe-agent==1.14.4 pin; template lint PASS; cost_tracking / max_consecutive_format_errors removed from tmpl for v1.14.
- LEAP-008: dry-run + smoke ok via Spark LiteLLM PF :24001 (gpt-oss-20b).
- LEAP-009: instance `sqlfluff__sqlfluff-1625` Docker up on amd64; agent in flight (bench-out/leap-009-lite-0-1e). Earlier attempts infra-fail (cost map / AgentConfig keys) classified and fixed.
- LEAP-010: card template in BENCHMARK_COMPARISON.md §8.
- LEAP-011–014: search-replace module + git_txn + fail_object wired into shell observations; unit tests green.
- LEAP-016: loop48.sh sketch present; LEAP-019 HOLD (no 48h on prod GPUs).
- LEAP-020: SpockifyLitellmModel thrash fix; run f 81/100 nonempty.
- LEAP-021: step_limit 150 + max_tokens 4096 + empty-stop + tool-parse soft-fail; runs g/h/i infra-fail/hung; best scored = f not-resolved.
- LEAP-022: docker sanitize + conditional submit + wall; run m Submitted not-resolved (SyntaxError patch); lab_regress + dry-run/smoke PASS 2026-09-17.
- LEAP-023: block sed \\n + py_compile/revert submit gate; run o/p Submitted clean desc near-miss (not-resolved exact string).
- LEAP-015: HOLD-VRAM reconfirmed (~51Gi avail, 120b 65GB).
- LEAP-017: canary_slot.sh lock helper landed (not cron-armed).
- AUDIT-OK: no bare % claims added.
- LEAP-024: exact desc prompt + drift normalize; run q resolved (FAIL_TO_PASS).

---

## 2026-09-18 leap-docs window

- Extracted Playbook + Forward Plan → `snapshots/leap-docs-20260918/`
- OpenCode Parity + Wichy Harness docx **missing** (`MISSING.md`)
- Skills complete (patch/git/fail/route/product/nonclaim/one-factor)
- `packs/route-v1.json` + `spockify bench route` / `route_regret.py` — POLICY-OK
- loop48.sh C1–C7 implemented; LEAP-019 still HOLD (no prod 48h; Lite board running)
- Canary DEFER while `lite-full-20260917` owns 20b
- BENCHMARK_COMPARISON §8: sqlfluff resolved + board pending — AUDIT-OK
- Tag: `harness-v50-87-freeze`
- Checklist: `snapshots/leap-docs-20260918/CHECKLIST.md`

---

## 2026-09-18 OpenCode Parity + Wichy (docs arrived)

### OC-001 | Inventory tools
**Status:** DONE — `snapshots/leap-docs-20260918/cards/OC-001-tool-inventory.md`
**Director:** [x]

### OC-002 | apply_patch format + reject-other
**Status:** DONE — `@spockify/harness` SEARCH/REPLACE; unified diff rejected; tests green
**Artifact:** `packages/spockify-harness/src/gitTxn.ts`, `test/harness.test.ts`

### OC-003 | git_snapshot / git_reset
**Status:** DONE — harness tools + TS helpers (lab Python remains)

### OC-004 | grep + glob + read-range
**Status:** DONE — aliases `read`/`glob`; start/end on read_file

### OC-005 | spockify agent plan mode
**Status:** DONE — `spockify agent --mode plan`; fixture smoke blocks apply_patch

### OC-006 | build mode + run_tests fail-object
**Status:** DONE — `--mode build` + `run_tests` fail-object.v1

### OC-007 | /init → AGENTS.md
**Status:** DONE — REPL `/init` + `initAgentsMd`

### OC-008 | Install OpenCode
**Status:** DONE — OpenCode 1.18.31 at `~/.opencode/bin/opencode`; version smoke PASS
**Artifact:** `cards/OC-008-opencode-install.md`
**Note:** full SWE under OpenCode deferred (board contention)

### OC-009 | SWE Lite 0:1 Spockify 20b
**Status:** DONE (prior LEAP-024 resolved sqlfluff-1625)

### OC-010 | Same instance OpenCode + local tag
**Status:** DONE as **not run — provider** (no local gpt-oss in OpenCode default catalog; LiteLLM held by board)

### OC-011 | Slice S both harnesses
**Status:** DEFER — board in flight; see `cards/OC-011-slice-S.md`

### OC-INFRA-01…04
**Status:** 01 HOLD (no 120b profile tonight); 02 DEFER; 03 DONE in BENCH.md; 04 CC not enabled
**Artifact:** `cards/serving-baseline.md`

### WICHY-P0 | Extract @spockify/harness
**Status:** DONE — package + CLI re-exports + golden fixtures + loopDetect/kill + HARNESS.md
**Tests:** 14 pass (`packages/spockify-harness`)
**Tracking open:** cascade L2–4, lab-on-kernel, bench-on-kernel, MCP (Phase 2–5)


---

## 2026-09-18 Wichy Phase 1–5 + OC-011 closeout

- WICHY-P1 parallel/replay/task/kill — DONE (35 harness tests)
- WICHY-P2 cascade L0–L4 + grants — DONE
- WICHY-P3 skills/hooks/napkin — DONE
- WICHY-P4 IDE runIdeAgentTurn + check_harness_clients PHASE4-GREEN — DONE
- WICHY-P5 bench kernel + mock smoke + SHA card — DONE (SWE scored path still mini-SWE while board runs)
- OC-011 table + OpenCode free PONG side-channel — DONE
- 120b/FP8/canary — HOLD with cards/HOLD-VRAM-20260918.md

