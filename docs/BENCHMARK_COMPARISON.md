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
| 2026-10-30 | SWE freeze `sqlfluff__sqlfluff-1625` | 1 | gpt-oss-20b | (unset) | `@spockify/harness` runHarness (default `--driver harness`) | **0** not-resolved (nonempty patch; official eval) | ~488s | 0 | `2ba122715d9e9f4a8e4f8e56e4bad5d6cf451cd7` | `snapshots/harness-swe-runHarness-20261030/CARD.md` |
| 2026-10-30 | Same-model OpenCode | 1 | gpt-oss-20b | — | OpenCode 1.18.31 + LiteLLM provider | **0** empty_patch | ~339s (`--auto`) | 0 | same | `snapshots/opencode-swe-20261030/B05-same-model.md` |
| 2026-10-30 | Lite test slice (board preds) | 3 | gpt-oss-20b | low-class | mini-SWE preds → `swebench.harness` | **2/3 resolved** (not board %) | ~57s/inst eval | 0 | — | `bench-out/p1-lite-eval-slice3/eval-b/` |
| 2026-10-30 | Lite test slice N=25 | 25 | gpt-oss-20b | low-class | mini-SWE preds → `swebench.harness` | **10/25 resolved** (14 unresolved, 1 error; not board %) | ~30s/inst eval | 0 | `1da3f843` trail | `snapshots/p1-roadmap-20261030/LITE-N25-CARD.md` |
| 2026-10-30 | Harness re-run `20261030c` | 1 | gpt-oss-20b | — | runHarness + FAIL_TO_PASS names | **0** not-resolved | ~394s | 0 | `1da3f843` | `snapshots/harness-swe-runHarness-20261030c/CARD.md` |
| 2026-10-30 | Lite full board preds | 300 | gpt-oss-20b | low-class | mini-SWE preds → `swebench.harness` | initial **36/106**; after 429-retry combined **68/296 (23.0%)**; 3 patch-apply left — **not board %** | ~52m + ~2.7h retry | 0 | `30db99ae` trail | `snapshots/lite-full-eval-20261030/CARD.md` |
| 2026-10-30 | Lite Hub-429 retry | 193 | gpt-oss-20b | low-class | same preds errors-only, batched | **32/190 completed**; 3 patch-apply | ~2.7h wall (incl. cooldowns) | 0 | — | `snapshots/lite-full-eval-429retry-20261030/CARD.md` |
| 2026-10-30 | Lite 3 residual micro | 3 | gpt-oss-20b | — | patch-apply IDs only | **0/3** errors again | ~3m | 0 | — | `snapshots/lite-patch-apply-3-20261030/CARD.md` |
| 2026-10-30 | Harness `20261030d` | 1 | gpt-oss-20b | — | runHarness + smoke/continue | **0** not-resolved | ~424s | 0 | `5f70f2bf` | `snapshots/harness-swe-runHarness-20261030d/CARD.md` |
| 2026-10-30 | OpenCode `20261030d` | 1 | gpt-oss-20b | — | OpenCode + instructions/`--dir` | **0** not-resolved (nonempty; was empty) | ~405s | 0 | — | `snapshots/opencode-swe-20261030d/B05-same-model.md` |
| 2026-10-30 | Harness astropy-12907 | 1 | gpt-oss-20b | — | runHarness Lite | **1/1 resolved** | ~913s | 0 | `88e3447f` | `snapshots/harness-swe-runHarness-20261030-astropy-12907/CARD.md` |
| 2026-10-30 | Harness N=3 Lite board | 3 | gpt-oss-20b | — | runHarness Lite | **1/3** (10914; 14995+11001 fail) | ~17m wall | 0 | `05fcab03` | `snapshots/harness-n3-20261030/CARD.md` |
| 2026-10-31 | OpenCode django-10914 B-05 | 1 | gpt-oss-20b | — | OpenCode Lite (same id as harness resolve) | **1/1 resolved** (patch ≡ harness) | ~941s | 0 | `f8ffa16a` | `snapshots/opencode-swe-20261030-django-10914/B05-same-model.md` |
| 2026-10-31 | Harness N=5 Lite board | 5 | gpt-oss-20b | — | runHarness Lite | **0/5** (all not-resolved; fail kept) | ~23m wall | 0 | `95437b78` | `snapshots/harness-n5-20261031/CARD.md` |
| 2026-10-31 | Empty-patch fix smoke | 2+1 | gpt-oss-20b | — | write-before-test gate | 10914 retest not-resolved; **11039 hypothesis2 resolved** | ~411s (11039) | 0 | — | `snapshots/harness-empty-patch-fix-20261031/CARD.md` |
| 2026-10-31 | OpenCode astropy-12907 B-05 | 1 | gpt-oss-20b | — | OpenCode Lite vs harness resolve | **0** empty_patch (harness was resolved) | ~236s | 0 | `c0365b73` | `snapshots/opencode-swe-20261031-astropy-12907/B05-same-model.md` |
| 2026-10-31 | Harness N=5b new Lite ids | 5 | gpt-oss-20b | — | runHarness Lite + write-before-test | **0/5** (fail kept; 2/5 empty residual) | ~42m wall | 0 | `0a1cd8e8` | `snapshots/harness-n5b-20261031/CARD.md` |
| 2026-10-31 | Noop-apply gate + empty-id smoke | 2 | gpt-oss-20b | — | reject identical SEARCH/REPLACE | **0/2** (12125, 6938 still empty; fail kept) | ~14m wall | 0 | `850d775e` | `snapshots/harness-noopgate-20261031/CARD.md` |
| 2026-10-31 | Harness N=5c new Lite ids | 5 | gpt-oss-20b | — | runHarness + write/noop gates | **0/5** (fail kept; 3/5 empty) | ~24m wall | 0 | `e59a183c` | `snapshots/harness-n5c-20261031/CARD.md` |
| 2026-10-31 | Tracked/repo-diff write gate | 1 | gpt-oss-20b | — | untracked ≠ unlock | **0** 11564 still empty (fail kept) | ~143s | 0 | `3ec4c2fb` | `snapshots/harness-trackedhyp-20261031/CARD.md` |
| 2026-10-31 | Harness N=5d new Lite ids | 5 | gpt-oss-20b | — | + tracked/repo-diff gate | **0/5** (fail kept; 4/5 empty) | ~28m wall | 0 | `3ec4c2fb` | `snapshots/harness-n5d-20261031/CARD.md` |
| 2026-10-31 | OpenCode django-11133 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness nonempty-fail | **0** empty_patch (harness nonempty not-resolved) | ~782s | 0 | `1c6edadd` | `snapshots/opencode-swe-20261031-b05-opencode-django-11133/B05-same-model.md` |
| 2026-10-31 | High-think canary 10914 | 1 | gpt-oss-20b | high | lab-kernel-stdio SPOCKIFY_HARNESS_THINKING | **1/1 resolved** | ~387s | 0 | `1c6edadd` | `snapshots/harness-highcanary-20261031/CARD.md` |
| 2026-10-31 | High-think django-11583 | 1 | gpt-oss-20b | high | new Lite id | **0** empty not-resolved (fail kept) | ~362s | 0 | `a98e5fb9` | `snapshots/harness-high-11583-20261031/CARD.md` |
| 2026-10-31 | High-think django-11742 | 1 | gpt-oss-20b | high | new Lite id | **0** empty (continue fired; fail kept) | ~389s | 0 | `bf22178b` | `snapshots/harness-high-11742-20261031/CARD.md` |
| 2026-10-31 | emptycont probe django-11133 | 1 | gpt-oss-20b | high | nonempty-fail re-run | **1/1 resolved** (continue_used=false; empty-diff did not fire) | ~421s | 0 | `45446755` | `snapshots/harness-emptycont-11133-20261031/CARD.md` |
| 2026-10-31 | smokecont probe django-11422 | 2 | gpt-oss-20b | high | pytest+`-k` smoke fix | **0/2** not-resolved; smoke-continue never fired | ~345s+285s | 0 | `d4cde0f8` | `snapshots/harness-smokecont-11422-20261031/CARD.md` |
| 2026-10-31 | smokecont3 reliability 11422 | 0 scored (local smoke) | — | — | test_patch + django-runtests + `.venv` | local smoke **False→True**; agent probe infra-blocked | n/a | 0 | `1e9e2877` | `snapshots/harness-smokecont3-11422-20261031/CARD.md` |
| 2026-10-31 | smokecont3 agent 11422 (PF) | 1 | gpt-oss-20b | high | test_patch + empty-diff continue | **1/1 resolved**; `test_patch.applied=true`; post `swe_smoke.ok=true` | ~458s | 0 | `603afbe3` | `snapshots/harness-smokecont3-11422-20261031/CARD.md` |
| 2026-10-31 | High-think django-11630 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved; local smoke ok≠official (fail kept) | ~525s | 0 | `088888a1` | `snapshots/harness-high-11630-20261031/CARD.md` |
| 2026-10-31 | High-think django-11797 | 1 | gpt-oss-20b | high | new Lite id | **0** empty not-resolved; continue fired; smoke false (fail kept) | ~394s | 0 | `28129aa2` | `snapshots/harness-high-11797-20261031/CARD.md` |
| 2026-10-31 | OpenCode django-11422 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** nonempty not-resolved (473 B) | ~119s | 0 | `57ab9167` | `snapshots/opencode-swe-20261031-b05-opencode-django__django-11422/B05-same-model.md` |
| 2026-10-31 | High-think django-11848 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; nonempty; smoke ok; continue unused | ~160s | 0 | `b6c5c399` | `snapshots/harness-high-11848-20261031/CARD.md` |
| 2026-10-31 | OpenCode django-11848 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~173s | 0 | `2be7b049` | `snapshots/opencode-swe-20261031-b05-opencode-django__django-11848/B05-same-model.md` |
| 2026-10-31 | High-think django-11905 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved; continue+smoke false (fail kept) | ~425s | 0 | `ff1874e7` | `snapshots/harness-high-11905-20261031/CARD.md` |
| 2026-10-31 | High-think django-11999 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; nonempty; continue used; smoke ok | ~275s | 0 | `0b59b6d4` | `snapshots/harness-high-11999-20261031/CARD.md` |
| 2026-10-31 | OpenCode django-11999 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~144s | 0 | `9c51ba2a` | `snapshots/opencode-swe-20261031-b05-opencode-django__django-11999/B05-same-model.md` |
| 2026-10-31 | High-think django-12284 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty; smoke-continue scored (fail kept) | ~750s | 0 | `97171a41` | `snapshots/harness-high-12284-20261031/CARD.md` |
| 2026-10-31 | High-think django-12308 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty; smoke-continue scored (fail kept) | ~740s | 0 | `025441e7` | `snapshots/harness-high-12308-20261031/CARD.md` |
| 2026-10-31 | High-think django-12453 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty; smoke null (fail kept) | ~304s | 0 |  | `snapshots/harness-high-12453-20261031/CARD.md` |
| 2026-10-31 | High-think django-12470 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved; continue+smoke false (fail kept) | ~531s | 0 | `971bdf8c` | `snapshots/harness-high-12470-20261031/CARD.md` |
| 2026-10-31 | High-think django-12497 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved; continue+smoke false (fail kept) | ~653s | 0 | `6708ae41` | `snapshots/harness-high-12497-20261031/CARD.md` |
| 2026-10-31 | High-think django-12589 | 1 | gpt-oss-20b | high | new Lite id | **0** empty not-resolved; continue fired (fail kept); freezes paused | ~743s | 0 | `a2c49132` | `snapshots/harness-high-12589-20261031/CARD.md` |

| 2026-10-31 | highfix+smoke ImportError fix | 1 | gpt-oss-20b | high | django-12453 re-probe | **1/1 resolved**; unique 7→8/27 | ~677s | 0 | `ad06744c` | `snapshots/harness-highfix-12453-20261031/CARD.md` |
| 2026-10-31 | High-think django-12708 | 1 | gpt-oss-20b | high | new Lite id | **0** empty (fail kept) | ~n/a | 0 | `b4f430fa` | `snapshots/harness-high-12708-20261031/CARD.md` |
| 2026-10-31 | High-think django-12700 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 8→9/27 | ~n/a | 0 | `55eeae21` | `snapshots/harness-high-12700-20261031/CARD.md` |
| 2026-10-31 | High-think django-12747 | 1 | gpt-oss-20b | high | new Lite id | **0** empty (fail kept) | ~n/a | 0 | `753503c7` | `snapshots/harness-high-12747-20261031/CARD.md` |
| 2026-10-31 | High-think django-12856 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved (fail kept) | ~n/a | 0 | `6a84b323a3fda69fcd5253db2d1a35a1d9842225` | `snapshots/harness-high-12856-20261031/CARD.md` |

| 2026-10-31 | OpenCode django-12700 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** nonempty not-resolved (1155 B) | ~331s | 0 | `37ef86647a8101ab920ebb0e082333daedb3b9f7` | `snapshots/opencode-swe-20261031-b05-opencode-django__django-12700/B05-same-model.md` |

| 2026-10-31 | High-think django-12915 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 9→10/27 | ~n/a | 0 | `fd35db74` | `snapshots/harness-high-12915-20261031/CARD.md` |
| 2026-10-31 | High-think django-13447 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 10→11/27 | ~337s | 0 | `60cd2c9d` | `snapshots/harness-high-13447-20261031/CARD.md` |
| 2026-10-31 | High-think django-13551 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 11→12/27 | ~442s | 0 | `e97efd77` | `snapshots/harness-high-13551-20261031/CARD.md` |
| 2026-11-01 | OpenCode django-13551 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~708s | 0 | `7953c63f` | `snapshots/opencode-swe-20261031-b05-opencode-django__django-13551/B05-same-model.md` |
| 2026-11-01 | High-think django-13590 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~n/a | 0 | `3d1600f8` | `snapshots/harness-high-13590-20261031/CARD.md` |
| 2026-11-01 | High-think django-13658 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~n/a | 0 | `27106664` | `snapshots/harness-high-13658-20261031/CARD.md` |

| 2026-10-31 | High-think django-12908 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved (fail kept) | ~n/a | 0 | `a4b034d8` | `snapshots/harness-high-12908-20261031/CARD.md` |

| 2026-10-31 | OpenCode django-12915 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~n/a | 0 |  | `snapshots/opencode-swe-20261031-b05-opencode-django__django-12915/B05-same-model.md` |
| 2026-10-31 | High-think django-12983 | 1 | gpt-oss-20b | high | new Lite id | **0** empty (fail kept) | ~n/a | 0 |  | `snapshots/harness-high-12983-20261031/CARD.md` |

Competitor same-slice rows: write `not run` or `harness refused tag` — never “N/A because we are better.”

**AUDIT-OK:** Historical sqlfluff pass@1=0 retained. Fail rows kept. Unique harness **12/27** (+13551). B-05 match **1/9** (13551 OC empty). High freezes **resumed** under smoke-ImportError continue + `_noop` reject + FAIL_TO_PASS path hint. Stop blind N / no re-thrash of 12284–12708/12747. Lite mini-SWE: **68/296**. Forbidden: beats OpenCode; “Spockify 80%”; abliterated as product model.

Allowed public line: *Default scored SWE driver is `@spockify/harness`; freeze instance sqlfluff-1625 not-resolved on gpt-oss-20b; same-model OpenCode empty_patch on that instance; Lite board preds graded 2/3 on a 3-instance slice.*

Leap + P1 artifacts: `snapshots/leap-20260916/`, `snapshots/p1-roadmap-20261030/`, `packs/canary-v1.json`, `scripts/bench/run_harness_swe_one.py`, `scripts/bench/run_opencode_swe_one.py`, `packages/spockify-harness/`, `docs/HARNESS.md`.

## 9. Suggested next measurement

1. Continue High freezes on **new** Lite ids (12908+); do not re-thrash 12284–12708/12747.
2. Card B-05 same-model OpenCode on harness-resolved **django-12700** (and later resolves only).
3. Improve harness planning/verification until sqlfluff freeze resolves without prompt-salvage of the historical pass@1=0 row.
4. When unique freezes healthier, scored mini-board N with honest Partial % (completed denominator only).

---

*Last updated 2026-11-01 (P1: unique 12/27; B-05 1/9; +13551; consecutive High empties 13590/13658 → stop chain).*
