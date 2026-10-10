# Spockify coding-agent comparison

**What this document is:** a methodological map of Spockify’s internal coding harness vs industry agent benches (OpenCode, Cursor, Aider, Claude Code, and friends), grounded in overnight lab results.

**What this document is not:** a published SWE-bench Verified / Terminal-Bench leaderboard claim that Spockify “beats OpenCode.” We have **not** run a shared, apples-to-apples industry suite against those products. Numbers below are **harness regress + local coding micro-evals** unless stated otherwise.

Related:

- How to run the SWE path: [`docs/BENCH.md`](BENCH.md)
- Overnight trails: [`snapshots/overnight-20260908/SUMMARY.md`](../snapshots/overnight-20260908/SUMMARY.md), [`snapshots/overnight-20260915/SUMMARY.md`](../snapshots/overnight-20260915/SUMMARY.md)
- Detail logs: `…/RESULTS.md` in each overnight dir

---

## 1. Verdict in one paragraph

Spockify’s overnight work (2026-09-08 tip **50** baseline → 2026-09-15 tips **51–87**) measured **closed-loop orch↔exec quality**: pytest-green invents, docs/rename/rate regress walls, stub salvage, WRITE gates, Cursor-parity UX (spawn HUD, Keep/Undo, `/think`, lab REPL chrome). That is a **different axis** from public **SWE-bench Verified**, **Terminal-Bench**, or **Aider polyglot** scores that OpenCode / Claude Code / Aider publish (or that third parties measure for them). Until Spockify posts a same-model, same-subset SWE/Terminal run, treat our suite as **product + harness health**, not a competitive % beat.

---

## 2. Two kinds of “coding agent quality”

| Axis | Question | Typical score | Spockify status (Sep 2026) |
|------|----------|---------------|----------------------------|
| **Model capability** | Given a fixed harness, how often does *this weights tag* solve hard repo tasks? | SWE-bench Verified pass@1, Terminal-Bench, Aider polyglot | Local tags only (`gpt-oss-20b`, `gpt-oss:120b`, …). No cloud / `:cloud`. |
| **Harness quality** | Given a fixed model, does the *loop* stop thrashing, write real files, verify, and hand off? | Internal regress walls, fail modes fixed per tip | **Primary overnight signal** — invent/rate/docs/calc/rename + tip batteries |
| **Product UX** | Does the IDE/CLI/chat feel like Cursor / Claude Code (status, Accept/Reject, multitask)? | Qualitative parity checklists | Mid-thought SPAWN, spawn chips, Generating…, review bar, lab `Rk/N · phase` |
| **Public leaderboard claim** | Can we cite a % vs OpenCode on a shared board? | Third-party harness×model tables | **No Spockify entry yet** — do not invent one |

Industry numbers always couple **model × harness × eval harness**. Example (third-party, not Spockify-run): Red Hat’s coding-agent bench reports Claude Opus 4.8 under OpenCode vs Claude Code on SWE-bench Verified at different costs — that measures *those* stacks, not Spockify. Cite sources when quoting; never paste a foreign % as ours.

---

## 3. What Spockify measured overnight

### 3.1 Suite shape

| Family | Goal | Pass signal | Typical wall (local `gpt-oss-20b`) |
|--------|------|-------------|-------------------------------------|
| **rate / hello / docs / calc / rename** | Harness regress (quality gates) | pytest green + docs/rename completeness | tip61 compose regress **~63s** all OK; tip59 Spark rate **~8s** Round 1 |
| **invent** (slug → bit/array/tree/math games) | Generate missing module from tests | pytest green, often Round 1 | tip62 minstack **~35s**; tip65 LRU **~28s**; tip75 Spark rate **~11s**; many tip74–87 invents Round 1 |
| **orch early-stop / stub / WRITE gates** | Stop DONE-loops, refuse reasoning-only stubs, nested fences | unit + micro | tip51b plan **~7.6s** / round **~27s**; tip53 rate **q10 ~9.4s**; tip58 already-green **~7s** |
| **Cursor-parity UX** | SPAWN HUD, Keep/Undo, Generating…, `/think`, lab REPL | smoke + screenshots / SSE | prod High SPAWN smoke **~404s** wall, 3 workers, merge OK |
| **`spockify bench` SWE** | Industry-shaped repo repair | mini-SWE-agent Lite/Verified slice | Path exists; twin **aarch64** blocked full SWE Docker; compose **dry-run / smoke** only so far |

### 3.2 Tip progression (compressed)

**2026-09-08 — tip 50 foundation** ([SUMMARY](../snapshots/overnight-20260908/SUMMARY.md))

Best tip: `50-exec-stream-early-stop-dsu` on WRITE/pytest/assert foundation. Example walls (quality 10):

| Eval | Wall |
|------|------|
| Anagrams + boot | **~9s** |
| Docs regress | **~11s** |
| Shop / calc / flatten | **~13–14s** |
| Rate regress | **~16s** (was ~293s DONE-loop class before early-stop) |
| DSU invent | **~22s** |
| Invent + boot | **~14–25s** |

**2026-09-15/16 — tips 51–87** ([SUMMARY](../snapshots/overnight-20260915/SUMMARY.md), [RESULTS](../snapshots/overnight-20260915/RESULTS.md))

Harness + UX overnight on compose + Spark LiteLLM PF (`gpt-oss-20b`; lab twin down for full walls):

| Tip band | Theme | Concrete signal |
|----------|-------|-----------------|
| 51–53 | Orch brace stop; open-fence gate; **stub-retry + `think=low`** | tip53 Spark rate **q10 ~9.4s** (best early harness win) |
| 54–58 | Docs quality; nested WRITE; nested early-stop; preseed green | compose docs **711 B / ~18s**; already-green **~7s** R1 |
| 59–61 | Double stub; rename completeness; expanded regress | Spark rate **~8s**; tip61 **rate/hello/docs/calc/rename** all OK **~63s** |
| 62–73 | WRITE sanitize; invent battery; ModuleNotFound force; post-batch pytest | minstack **~35s**; LRU **~28s**; validbst Round 2 |
| 74–87 | Easy invent expansion + regress PF `:24001` + lab `/think` | Four invents/tip mostly Round 1; tip79/85 regress OK; tip87 closes overnight |

End state (~07:00 Stockholm): tips **51–87** landed; prod SPAWN/OWUI/Comfy/XTTS left on overnight images; twin still down for SWE walls.

### 3.3 Cursor-parity targets (product, not SWE %)

Done overnight / recent: spawn HUD + “Planning next moves”; CLI `spockify_agents` spinner; Keep/Undo keys; Ctrl+K Generating…; review phase bar; Wrapping up on streamDone; CLI `/think` Off→Heavy; lab REPL live `Rk/N · phase`.

Open / low: optional SPAWN temperature tune; more harness evals; **industry SWE/Terminal shared run**.

---

## 4. How that maps to other agents

Methodological comparison only — **not** a claim that Spockify outscores these products on their home benches.

| Product | What they optimize for | Public bar people cite | Relation to Spockify overnight |
|---------|------------------------|------------------------|--------------------------------|
| **OpenCode** | Open coding agent harness; often evaluated on SWE / Terminal with strong cloud models | Third-party SWE Verified harness×model tables (e.g. Opus under OpenCode vs Claude Code) | Same *problem class* as `spockify bench swe`, **not** invent/rate micros. No shared Spockify×OpenCode run yet. |
| **Cursor** | IDE agent + Tab/FIM + inline edit UX | Qualitative “feels like Cursor”; occasional private SWE-style evals | Overnight **UX parity** is the closest match (HUD, Accept/Reject, multitask). Not a leaderboard %. |
| **Claude Code** | CLI agent on Anthropic models | Often tops same-model SWE tables vs other harnesses | Spockify lab orch/exec is a cousin *shape* (plan→tools→verify); models are local OSS, not Opus. |
| **Aider** | Git-native edit loop; polyglot bench | **Aider polyglot** leaderboard | Different edit protocol; Spockify has no published polyglot %. |
| **OpenHands / mini-SWE-agent** | SWE-bench scaffolding | SWE Lite / Verified trajectories | Spockify **reuses mini-SWE-agent** for `spockify bench swe` ([BENCH.md](BENCH.md)); dry-run/smoke done; full Docker eval blocked on twin aarch64. |
| **Codex / others** | Vendor coding agents | SWE / internal benches | Out of scope for local-only Spockify product claims. |

### Same-model vs harness quality

- **Same model, different harness:** industry tables show large score gaps (Claude Code vs OpenCode vs Pi on one weights tag). That is the right frame for a future Spockify vs OpenCode compare: fix `gpt-oss:120b` (or a shared open tag), fix subset, vary only agent loop.
- **Same harness, different model:** SWE Verified leaderboards mix frontier APIs; Spockify refuses cloud tags for product defaults, so “beat Opus+OpenCode” is not an on-box goal.
- **Spockify overnight:** almost entirely **same local model, improving harness** (tips 50→87). That is why walls fell from multi-minute DONE-loops to single-digit / low-tens seconds on micros — harness signal, not a new foundation model.

---

## 5. Spockify suite vs industry benches

| | Spockify internal suite | SWE-bench Verified | Terminal-Bench | Aider polyglot |
|--|-------------------------|--------------------|----------------|----------------|
| **Task** | Tiny fixtures: invent module, fix rate.py, write API.md, rename | Real GitHub issues in popular repos | Shell/terminal multi-step | Multi-language edit exercises |
| **Oracle** | Local pytest / file quality gates | Hidden tests in Docker | Task-specific checks | Unit tests per exercise |
| **Agent** | `spockify lab` orch/exec | mini-SWE / OpenHands / vendor | Vendor / open agents | Aider |
| **Spockify overnight** | **Yes — primary** | Path only; no verified % | Not run | Not run |
| **Comparable to OpenCode?** | No (different tasks) | **Yes — once both run same slice** | Yes, if both run | Only if Spockify grows a polyglot driver |

### What we’d need for apples-to-apples

1. **Host that can pull SWE Docker images** — amd64 or working qemu on aarch64 twin; not prod chat GPU starvation.
2. **Fixed subset** — start `spockify bench swe --subset verified --slice 0:N` (or Lite) with N small, then grow; log preds under `bench-out/`.
3. **Fixed model tags** — e.g. `gpt-oss:120b` (or another open tag both sides can run); document think effort; no cloud.
4. **Fixed agent entry** — Spockify via mini-SWE-agent config in `scripts/bench/`; OpenCode (or Claude Code) via their documented SWE runner on the **same** instances.
5. **Report model × harness × subset × date** — never a bare “Spockify 80%” without those four.
6. **Optional:** Terminal-Bench 2.0 and/or Aider polyglot as secondary boards once SWE smoke is green.

Until that ships, the honest public line is:

> Spockify’s coding loop is improving on internal regress and invent micros (see overnight SUMMARY). Industry SWE/Terminal comparison is **instrumented but not yet scored**.

---

## 6. Concrete overnight numbers (do not over-read)

### Harness walls (representative)

| Source | Metric | Value |
|--------|--------|-------|
| overnight-20260908 tip50 | Rate regress after early-stop | **~16s** (was ~293s stream/DONE-loop class) |
| overnight-20260908 tip50 | Docs / anagrams / DSU | **~11s / ~9s / ~22s** |
| overnight-20260915 tip51b | Plan / full round (brace stop) | **~7.6s / ~27s** |
| overnight-20260915 tip53 | Spark rate micro | **q10 ~9.4s** |
| overnight-20260915 tip54–55 | Compose docs / rate | **~18s** (API.md **711 B**), rate **~16s** |
| overnight-20260915 tip58 | Already-green stop | **~7s** Round 1 |
| overnight-20260915 tip59 | Spark rate | **~8s** Round 1, 3 passed |
| overnight-20260915 tip61 | Expanded regress | **~63s** rate+hello+docs+calc+rename OK |
| overnight-20260915 tip75 / tip87 | Spark rate | Round 1 **~11s** band / Round 1 close |
| overnight-20260915 SPAWN smoke | High mid-thought, 3 workers | **~404s** wall, merge done |

### What we explicitly do **not** have

- No Spockify SWE-bench Verified pass@1 %
- No Spockify Terminal-Bench %
- No Spockify vs OpenCode head-to-head on a shared instance list
- No claim that invent Round-1 greens generalize to multi-file GitHub issues

---

## 7. Where the code and docs live

| Artifact | Path |
|----------|------|
| Bench how-to | [`docs/BENCH.md`](BENCH.md) |
| This comparison | [`docs/BENCHMARK_COMPARISON.md`](BENCHMARK_COMPARISON.md) |
| SWE driver | `spockify bench`, `scripts/run-swebench.sh`, `scripts/bench/` |
| Lab closed-loop (private) | `packages/spockify-lab-agents/` (stripped from public OSS export) |
| Sep 8 overnight | `snapshots/overnight-20260908/{SUMMARY,RESULTS}.md` |
| Sep 15 overnight | `snapshots/overnight-20260915/{SUMMARY,RESULTS}.md` + `runs/` |

The public OSS mirror ships BENCH + this comparison + overnight SUMMARY/RESULTS when the export scrub allows; lab-agents and private ops stay private (see `docs/OSS_MIRROR.md` in the private tree).

---

## 8. Four-factor card template (Leap / LEAP-010)

Paste a row only when a trajectory exists. Empty cells are OK; bare percentages are not. **AUDIT** before any public sentence.

| Date | Subset | N | Model | Think | Harness | pass@1 | Median wall | Infra-fail rate | Commit SHA | Trajectory |
|------|--------|---|-------|-------|---------|--------|-------------|-----------------|------------|------------|
| 2026-09-16 | SWE-bench Lite | 0:1 (`sqlfluff__sqlfluff-1625`) | gpt-oss-20b | _(unset; salvage adapter)_ | Spockify mini-SWE 1.14.4 + SpockifyLitellmModel | **0** (early not-resolved runs) | ~56 min | 0 on scored runs | _(leap SUMMARY)_ | `snapshots/leap-20260916/cards/sqlfluff__sqlfluff-1625.md` |
| 2026-09-17 | SWE-bench Lite | 0:1 (`sqlfluff__sqlfluff-1625`) | gpt-oss-20b | low-class | Spockify mini-SWE 1.14.4 + LEAP-024 gates | **1/1 resolved** (FAIL_TO_PASS; CLI 69 passed) — **not** a Lite board % | ~1 min / 13 calls (run q) | 0 | _(leap NOTES-024)_ | same card (run q) |
| 2026-09-17→ | SWE-bench Lite | full test (~300) | gpt-oss-20b | low-class | same harness; board `lite-full-20260917` | **pending** official harness eval — interim preds only | in progress | TBD | — | `bench-out/lite-full-20260917/` (gitignored) |
| 2026-09-18 | SWE-bench Lite | OpenCode same-slice row C | gpt-oss:120b / 20b | — | OpenCode 1.18.31 | **not run — provider** (no local gpt-oss in default catalog; LiteLLM PF held by board) | — | — | — | `snapshots/leap-docs-20260918/cards/OC-008-opencode-install.md` |
| 2026-09-18 | OC-011 table | A: Lite 0:1 sqlfluff | gpt-oss-20b | low-class | mini-SWE (board path) | **1/1** prior LEAP-024 — not board % | — | 0 | — | `cards/OC-011-dual-harness.md` |
| 2026-09-18 | OC-011 side | OpenCode free smoke | ling-3.0-flash-fin-free | — | OpenCode 1.18.31 | smoke PONG (not same-tag; not SWE) | seconds | 0 | — | `cards/OC-011-opencode-free-smoke.log` |
| 2026-09-18 | Kernel Phase 5 | mock fixture | mock | — | `@spockify/harness` | 35/35 unit PASS | — | 0 | _(ship SHA)_ | `cards/PHASE5-kernel-card.md` |

Competitor same-slice rows: write `not run` or `harness refused tag` — never “N/A because we are better.”

**AUDIT-OK:** instance pass on sqlfluff-1625 is evidenced; do not cite as Lite board pass@1. Full-board % only after `swebench.harness` eval. OpenCode row is explicitly missing-provider — not a parity claim. Free-model PONG is not a same-tag score.

Kernel note: `@spockify/harness` Phases 0–5 code landed 2026-09-18. Scored SWE rows still mini-SWE until board completes.

Allowed public line: *SWE-bench path is instrumented; sqlfluff-1625 resolved on gpt-oss-20b (N=1); full Lite board in progress; OpenCode installed on SWE host but same-tag row not run (provider).* Forbidden: beats OpenCode/Cursor/Claude Code; “Spockify 80%”; abliterated as product model; quality/10 as frontier skill.

Leap freeze artifacts: `snapshots/leap-20260916/`, `packs/canary-v1.json`, `packs/route-v1.json`, `scripts/bench/schema-trace.v1.json`, `snapshots/leap-docs-20260918/`, `packages/spockify-harness/`, `docs/HARNESS.md`.

## 9. Suggested next measurement (when Docker + LiteLLM are ready)

1. `spockify bench dry-run` + `smoke --model gpt-oss-20b` on compose or Spark LiteLLM PF (not router).
2. `spockify bench swe --subset lite --slice 0:1 --workers 1` until one trajectory completes (amd64 Docker preferred).
3. Let the in-flight Lite full board finish; then `eval_lite_preds.sh` — do not kill/restart mid-board.
4. Expand to a fixed Verified slice (e.g. 25–50) with `gpt-oss:120b` when VRAM is Tim-safe.
5. `spockify bench route --pack packs/route-v1.json` for offline regret (always-20b baseline).
6. Run the **same** slice under OpenCode (or Claude Code) with the **same** open model if possible — or document cloud-model asymmetry explicitly.
7. Fill the section 8 table: date, subset, model, harness, pass@1, cost/wall — still no bare marketing %.

---

*Last updated 2026-09-18 (leap-docs) from overnight + leap-forward + LEAP-024 resolve + Lite board in progress.*
