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
| **`spockify bench` SWE** | Industry-shaped repo repair | Default `@spockify/harness` `runHarness`; legacy `--driver mini` | Scored freeze + Lite board preds graded on Spock Docker; twin **aarch64** still awkward for full SWE images |

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
| **OpenHands / mini-SWE-agent** | SWE-bench scaffolding | SWE Lite / Verified trajectories | Default scored driver is `@spockify/harness`; legacy `--driver mini` still wraps mini-SWE-agent ([BENCH.md](BENCH.md)). Lite board preds were mini-SWE-era; Spock Docker graded **70/300** (post harness pred-regen×3). |
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
| 2026-09-17→ | SWE-bench Lite | full test (~300) | gpt-oss-20b | low-class | same harness; board `lite-full-20260917` | preds graded: combined **70/300 (23.3%)** completed (post pred-regen×3) | eval done 2026-10-30 | 0 | `30db99ae` trail | `snapshots/lite-full-eval-20261030/CARD.md` |
| 2026-09-18 | SWE-bench Lite | OpenCode same-slice row C | gpt-oss:120b / 20b | — | OpenCode 1.18.31 | **not run — provider** (no local gpt-oss in default catalog; LiteLLM PF held by board) | — | — | — | `snapshots/leap-docs-20260918/cards/OC-008-opencode-install.md` |
| 2026-09-18 | OC-011 table | A: Lite 0:1 sqlfluff | gpt-oss-20b | low-class | mini-SWE (board path) | **1/1** prior LEAP-024 — not board % | — | 0 | — | `cards/OC-011-dual-harness.md` |
| 2026-09-18 | OC-011 side | OpenCode free smoke | ling-3.0-flash-fin-free | — | OpenCode 1.18.31 | smoke PONG (not same-tag; not SWE) | seconds | 0 | — | `cards/OC-011-opencode-free-smoke.log` |
| 2026-09-18 | Kernel Phase 5 | mock fixture | mock | — | `@spockify/harness` | 35/35 unit PASS | — | 0 | _(ship SHA)_ | `cards/PHASE5-kernel-card.md` |
| 2026-10-30 | SWE freeze `sqlfluff__sqlfluff-1625` | 1 | gpt-oss-20b | (unset) | `@spockify/harness` runHarness (default `--driver harness`) | **0** not-resolved (nonempty patch; official eval) | ~488s | 0 | `2ba122715d9e9f4a8e4f8e56e4bad5d6cf451cd7` | `snapshots/harness-swe-runHarness-20261030/CARD.md` |
| 2026-10-30 | Same-model OpenCode | 1 | gpt-oss-20b | — | OpenCode 1.18.31 + LiteLLM provider | **0** empty_patch | ~339s (`--auto`) | 0 | same | `snapshots/opencode-swe-20261030/B05-same-model.md` |
| 2026-10-30 | Lite test slice (board preds) | 3 | gpt-oss-20b | low-class | mini-SWE preds → `swebench.harness` | **2/3 resolved** (not board %) | ~57s/inst eval | 0 | — | `bench-out/p1-lite-eval-slice3/eval-b/` |
| 2026-10-30 | Lite test slice N=25 | 25 | gpt-oss-20b | low-class | mini-SWE preds → `swebench.harness` | **10/25 resolved** (14 unresolved, 1 error; not board %) | ~30s/inst eval | 0 | `1da3f843` trail | `snapshots/p1-roadmap-20261030/LITE-N25-CARD.md` |
| 2026-10-30 | Harness re-run `20261030c` | 1 | gpt-oss-20b | — | runHarness + FAIL_TO_PASS names | **0** not-resolved | ~394s | 0 | `1da3f843` | `snapshots/harness-swe-runHarness-20261030c/CARD.md` |
| 2026-10-30 | Lite full board preds | 300 | gpt-oss-20b | low-class | mini-SWE preds → `swebench.harness` | initial **36/106**; after 429-retry+pred-regen×3 combined **70/300 (23.3%)** | ~52m + ~2.7h retry | 0 | `30db99ae` trail | `snapshots/lite-full-eval-20261030/CARD.md` |
| 2026-10-30 | Lite Hub-429 retry | 193 | gpt-oss-20b | low-class | same preds errors-only, batched | **32/190 completed**; 3 patch-apply | ~2.7h wall (incl. cooldowns) | 0 | — | `snapshots/lite-full-eval-429retry-20261030/CARD.md` |
| 2026-11-03 | Lite pred-regen×3 residuals | 3 | gpt-oss-20b | low | harness runHarness → `swebench.harness` | **2/3 resolved** (12113+8506); 12184 unresolved; combined board **70/300** | ~40m regen + ~1m eval | 0 | `d5bf96cb` | `snapshots/lite-predregen3-20261103/CARD.md` |
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
| 2026-11-01 | High-think django-13660 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 12→13/27 | ~638s | 0 | `1c304330` | `snapshots/harness-high-13660-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-13660 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** nonempty not-resolved (652 B) | ~660s | 0 | `1ba8d51e` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-13660/B05-same-model.md` |
| 2026-11-01 | High-think django-13710 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~n/a | 0 | `1ba8d51e` | `snapshots/harness-high-13710-20261101/CARD.md` |
| 2026-11-01 | High-think django-13757 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~n/a | 0 | `1ba8d51e` | `snapshots/harness-high-13757-20261101/CARD.md` |
| 2026-11-01 | High-think django-13768 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 13→14/27 | ~n/a | 0 | `b99a5b3e` | `snapshots/harness-high-13768-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-13768 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~63s | 0 | `94daf168` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-13768/B05-same-model.md` |
| 2026-11-01 | High-think django-13925 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved (fail kept) | ~n/a | 0 | `8cce4a6b` | `snapshots/harness-high-13925-20261101/CARD.md` |
| 2026-11-01 | High-think django-13933 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~690s | 0 | `de925b34` | `snapshots/harness-high-13933-20261101/CARD.md` |
| 2026-11-01 | High-think django-13964 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty eval patch-apply error (fail kept) | ~940s | 0 | `e9b6a0f9` | `snapshots/harness-high-13964-20261101/CARD.md` |
| 2026-11-01 | High-think django-14016 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 14→15/27 | ~840s | 0 | `a40a28e9` | `snapshots/harness-high-14016-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-14016 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~104s | 0 | `d02b89bc` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-14016/B05-same-model.md` |
| 2026-11-01 | High-think django-14017 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~779s | 0 | `c330a62d` | `snapshots/harness-high-14017-20261101/CARD.md` |
| 2026-11-01 | High-think django-14155 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~478s | 0 | `7fa41091` | `snapshots/harness-high-14155-20261101/CARD.md` |
| 2026-11-01 | High-think django-14238 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~217s | 0 | `d7a248c2` | `snapshots/harness-high-14238-20261101/CARD.md` |
| 2026-11-01 | High-think django-14382 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 15→16/27 | ~156s | 0 | `7c0656ad` | `snapshots/harness-high-14382-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-14382 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **1** both resolved (match 2/12) | ~113s | 0 | `7c0656ad` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-14382/B05-same-model.md` |
| 2026-11-01 | High-think django-14411 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty wrong-file (fail kept) | ~468s | 0 | `7c0656ad` | `snapshots/harness-high-14411-20261101/CARD.md` |
| 2026-11-01 | High-think django-14534 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 16→17/27 | ~613s | 0 | `7c0656ad` | `snapshots/harness-high-14534-20261101/CARD.md` |
| 2026-11-01 | High-think django-14580 | 1 | gpt-oss-20b | high | new Lite id | **1/1 resolved**; unique 17→18/27 | ~828s | 0 | `bc72d21a` | `snapshots/harness-high-14580-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-14752 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~n/a | 0 | `07e0eea5` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-14752/B05-same-model.md` |
| 2026-11-01 | High django-14787 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~15m | 0 | `d592451b` | `snapshots/harness-high-14787-20261101/CARD.md` |
| 2026-11-01 | High django-14855 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved | ~5m | 1 | `d592451b` | `snapshots/harness-high-14855-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-14855 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **1** resolved (match) | ~2m | 1 | `d592451b` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-14855/B05-same-model.md` |
| 2026-11-01 | High django-14915 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~8m | 0 | `d592451b` | `snapshots/harness-high-14915-20261101/CARD.md` |
| 2026-11-01 | High django-14997 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~14m | 0 | `8830eb86` | `snapshots/harness-high-14997-20261101/CARD.md` |
| 2026-11-01 | High django-14999 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~16m | 0 | `281bf341` | `snapshots/harness-high-14999-20261101/CARD.md` |
| 2026-11-01 | High django-15061 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~4m | 0 | `d892f42b` | `snapshots/harness-high-15061-20261101/CARD.md` |
| 2026-11-01 | High django-15202 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~5m | 0 | `d892f42b` | `snapshots/harness-high-15202-20261101/CARD.md` |
| 2026-11-01 | High django-15213 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~6m | 0 | `d892f42b` | `snapshots/harness-high-15213-20261101/CARD.md` |
| 2026-11-01 | High django-15252 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~18m | 0 | `843f52e7` | `snapshots/harness-high-15252-20261101/CARD.md` |
| 2026-11-01 | High django-15320 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~11m | 0 | `843f52e7` | `snapshots/harness-high-15320-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-15347 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **1** resolved | ~n/a | 1 |  |  |
| 2026-11-01 | OpenCode django-15388 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty | ~n/a | 0 |  |  |
| 2026-11-01 | High django-15347 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; unique 20→21/27 | ~6m | 1 | `843f52e7` | `snapshots/harness-high-15347-20261101/CARD.md` |
| 2026-11-01 | High django-15400 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 |  |  |
| 2026-11-01 | High django-15388 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; unique 21→22/27 | ~n/a | 1 |  |  |
| 2026-11-01 | B-05 OpenCode django-14580 | 1 | gpt-oss-20b | — | same-model OC | **0** nonempty miss; match 2/14 | ~n/a | 0 | `bc72d21a` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-14580/CARD.md` |
| 2026-11-01 | High-think django-14608 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved (fail kept) | ~645s | 0 | `bc72d21a` | `snapshots/harness-high-14608-20261101/CARD.md` |
| 2026-11-01 | High-think django-14667 | 1 | gpt-oss-20b | high | new Lite id | **0** empty after continues (fail kept) | ~366s | 0 | `bc72d21a` | `snapshots/harness-high-14667-20261101/CARD.md` |
| 2026-11-01 | OpenCode django-14534 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~181s | 0 | `7c0656ad` | `snapshots/opencode-swe-20261101-b05-opencode-django__django-14534/B05-same-model.md` |

| 2026-10-31 | High-think django-12908 | 1 | gpt-oss-20b | high | new Lite id | **0** nonempty not-resolved (fail kept) | ~n/a | 0 | `a4b034d8` | `snapshots/harness-high-12908-20261031/CARD.md` |

| 2026-10-31 | OpenCode django-12915 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty_patch (harness resolved) | ~n/a | 0 |  | `snapshots/opencode-swe-20261031-b05-opencode-django__django-12915/B05-same-model.md` |
| 2026-10-31 | High-think django-12983 | 1 | gpt-oss-20b | high | new Lite id | **0** empty (fail kept) | ~n/a | 0 |  | `snapshots/harness-high-12983-20261031/CARD.md` |

Competitor same-slice rows: write `not run` or `harness refused tag` — never “N/A because we are better.”

| 2026-11-01 | High django-15498 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `bfcc9937` | `snapshots/harness-high-15498-20261101/CARD.md` |
| 2026-11-01 | High django-15695 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `e1eaff56` | `snapshots/harness-high-15695-20261101/CARD.md` |
| 2026-11-01 | High django-15738 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `c5abc881` | `snapshots/harness-high-15738-20261101/CARD.md` |

| 2026-11-01 | High django-15781 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; unique →25/27 | ~n/a | 1 |  |  |
| 2026-11-01 | High django-15789 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; unique →25/27 | ~n/a | 1 |  |  |
| 2026-11-01 | High django-15790 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; unique →25/27 | ~n/a | 1 |  |  |
| 2026-11-01 | OpenCode django-15781 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty | ~n/a | 0 |  |  |
| 2026-11-01 | OpenCode django-15789 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty | ~n/a | 0 |  |  |
| 2026-11-01 | OpenCode django-15790 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** nonempty miss | ~n/a | 0 |  |  |

| 2026-11-02 | High django-15814 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 |  |  |
| 2026-11-02 | High django-15819 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 |  |  |
| 2026-11-02 | High django-15851 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; unique →26/27 | ~n/a | 1 |  |  |
| 2026-11-02 | OpenCode django-15851 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty | ~n/a | 0 |  |  |

| 2026-11-02 | High django-15902 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `091c9cd6` | `snapshots/harness-high-15902-20261102/CARD.md` |
| 2026-11-02 | High django-15996 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `01f62aac` | `snapshots/harness-high-15996-20261102/CARD.md` |
| 2026-11-02 | High django-16041 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; unique →27/27 | ~n/a | 1 | `2758ee50` | `snapshots/harness-high-16041-20261102/CARD.md` |
| 2026-11-02 | OpenCode django-16041 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty | ~n/a | 0 | `f3a91d6f` | `snapshots/opencode-swe-20261102-b05-opencode-django__django-16041/B05-same-model.md` |

| 2026-11-02 | High django-16046 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; post-slice (unique stays 27/27 closed) | ~n/a | 1 |  |  |
| 2026-11-02 | High django-16139 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 |  |  |
| 2026-11-02 | High django-16229 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 |  |  |
| 2026-11-02 | OpenCode django-16046 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** nonempty miss | ~n/a | 0 |  |  |

| 2026-11-03 | High django-16255 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `e514b9da` | `snapshots/harness-high-16255-20261103/CARD.md` |
| 2026-11-03 | High django-16379 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; post-slice (unique stays 27/27 closed) | ~n/a | 1 | `3f28cb1b` | `snapshots/harness-high-16379-20261103/CARD.md` |
| 2026-11-03 | High django-16400 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `30bde6fc` | `snapshots/harness-high-16400-20261103/CARD.md` |
| 2026-11-03 | OpenCode django-16379 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **1** resolved | ~n/a | 1 | `38b459b3` | `snapshots/opencode-swe-20261103-b05-opencode-django__django-16379/B05-same-model.md` |

| 2026-11-03 | High django-16408 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `8550728f` | `snapshots/harness-high-16408-20261103/CARD.md` |
| 2026-11-03 | High django-16527 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; post-slice (unique stays 27/27 closed) | ~n/a | 1 | `65c6e1bf` | `snapshots/harness-high-16527-20261103/CARD.md` |
| 2026-11-03 | High django-16595 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `a76d6a59` | `snapshots/harness-high-16595-20261103/CARD.md` |
| 2026-11-03 | OpenCode django-16527 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **1** resolved | ~n/a | 1 | `2d5d15e2` | `snapshots/opencode-swe-20261103-b05-opencode-django__django-16527/B05-same-model.md` |

| 2026-11-03 | High django-16816 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `6bc7b6bd` | `snapshots/harness-high-16816-20261103/CARD.md` |
| 2026-11-03 | High django-16820 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `580a6f80` | `snapshots/harness-high-16820-20261103/CARD.md` |
| 2026-11-03 | High django-16873 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `8f90d435` | `snapshots/harness-high-16873-20261103/CARD.md` |

| 2026-11-03 | High django-16910 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `b9d7b661` | `snapshots/harness-high-16910-20261103/CARD.md` |
| 2026-11-03 | High django-17051 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `76eed7fd` | `snapshots/harness-high-17051-20261103/CARD.md` |
| 2026-11-03 | High django-17087 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `5dcce00a` | `snapshots/harness-high-17087-20261103/CARD.md` |

| 2026-11-03 | High astropy-14182 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `b42176be` | `snapshots/harness-high-14182-20261103/CARD.md` |
| 2026-11-03 | High matplotlib-18869 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `4260edfd` | `snapshots/harness-high-18869-20261103/CARD.md` |
| 2026-11-03 | High sympy-11400 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `5c839abd` | `snapshots/harness-high-11400-20261103/CARD.md` |

| 2026-11-03 | High sympy-11870 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `a28ad659` | `snapshots/harness-high-11870-20261103/CARD.md` |
| 2026-11-03 | High astropy-14365 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `f5666343` | `snapshots/harness-high-14365-20261103/CARD.md` |

| 2026-11-03 | High sympy-11897 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `e9bf7966` | `snapshots/harness-high-11897-20261103/CARD.md` |
| 2026-11-03 | High astropy-14995 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `8e3a9bbf` | `snapshots/harness-high-14995-20261103/CARD.md` |

| 2026-11-03 | High sympy-12171 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `0efa1011` | `snapshots/harness-high-12171-20261103/CARD.md` |
| 2026-11-03 | High astropy-6938 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `fd6af470` | `snapshots/harness-high-6938-20261103/CARD.md` |

| 2026-11-03 | High sympy-12236 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `e5fc51fb` | `snapshots/harness-high-12236-20261103/CARD.md` |
| 2026-11-03 | High sympy-12454 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `18f4843c` | `snapshots/harness-high-12454-20261103/CARD.md` |

| 2026-11-03 | High sympy-12419 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `0b7f9ee9` | `snapshots/harness-high-12419-20261103/CARD.md` |
| 2026-11-03 | High sympy-12481 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `43e43244` | `snapshots/harness-high-12481-20261103/CARD.md` |

| 2026-11-03 | High sympy-13031 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `887be47c` | `snapshots/harness-high-13031-20261103/CARD.md` |
| 2026-11-03 | High sympy-13043 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `c37477af` | `snapshots/harness-high-13043-20261103/CARD.md` |

| 2026-11-03 | High sympy-13146 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `c74b5ea9` | `snapshots/harness-high-13146-20261103/CARD.md` |
| 2026-11-03 | High sympy-13177 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `272bb0e2` | `snapshots/harness-high-13177-20261103/CARD.md` |

| 2026-11-03 | High sympy-13437 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `0956bc64` | `snapshots/harness-high-13437-20261103/CARD.md` |
| 2026-11-03 | High sympy-13471 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `012b2825` | `snapshots/harness-high-13471-20261103/CARD.md` |

| 2026-11-03 | High sympy-13480 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `3f1115b7` | `snapshots/harness-high-13480-20261103/CARD.md` |
| 2026-11-03 | High sympy-13647 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `096665f3` | `snapshots/harness-high-13647-20261103/CARD.md` |

| 2026-11-03 | High matplotlib-23987 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `7d243776` | `snapshots/harness-high-23987-20261103/CARD.md` |
| 2026-11-03 | High sympy-13773 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `18d6389a` | `snapshots/harness-high-13773-20261103/CARD.md` |
| 2026-11-03 | High sympy-13895 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `4402befe` | `snapshots/harness-high-13895-20261103/CARD.md` |

| 2026-11-03 | High sympy-13915 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `141c5593` | `snapshots/harness-high-13915-20261103/CARD.md` |
| 2026-11-03 | High sympy-13971 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `cc353c11` | `snapshots/harness-high-13971-20261103/CARD.md` |

| 2026-11-03 | High sympy-14024 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `da1f8a7e` | `snapshots/harness-high-14024-20261103/CARD.md` |
| 2026-11-03 | High sympy-14308 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `ec1c027e` | `snapshots/harness-high-14308-20261103/CARD.md` |

| 2026-11-03 | High sympy-14317 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `935028e7` | `snapshots/harness-high-14317-20261103/CARD.md` |
| 2026-11-03 | High sympy-14396 | 1 | gpt-oss-20b | high | harness freeze | **1** resolved; post-slice (unique stays 27/27 closed) | ~n/a | 1 | `b1cdea56` | `snapshots/harness-high-14396-20261103/CARD.md` |
| 2026-11-03 | OpenCode sympy-14396 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** nonempty miss | ~n/a | 0 | `7ee06334` | `snapshots/opencode-swe-20261103-b05-opencode-sympy__sympy-14396/B05-same-model.md` |

| 2026-11-03 | High sympy-14774 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `107c599c` | `snapshots/harness-high-14774-20261103/CARD.md` |
| 2026-11-03 | High sympy-14817 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `e2a88b7c` | `snapshots/harness-high-14817-20261103/CARD.md` |

| 2026-11-03 | High sympy-15011 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `9bba05f7` | `snapshots/harness-high-15011-20261103/CARD.md` |
| 2026-11-03 | High sympy-15308 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `52cf25c2` | `snapshots/harness-high-15308-20261103/CARD.md` |

| 2026-11-03 | High sympy-15345 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `a1ae3314` | `snapshots/harness-high-15345-20261103/CARD.md` |
| 2026-11-03 | High sympy-15346 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `a8323079` | `snapshots/harness-high-15346-20261103/CARD.md` |

| 2026-11-03 | OpenCode django-12453 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** nonempty miss (1071 B) | ~n/a | 0 | `f5cda8f3` | `snapshots/opencode-swe-20261103-b05-opencode-django__django-12453/B05-same-model.md` |
| 2026-11-03 | OpenCode django-11039 B-05 | 1 | gpt-oss-20b | — | OpenCode vs harness resolve | **0** empty | ~n/a | 0 | `f5cda8f3` | `snapshots/opencode-swe-20261103-b05-opencode-django__django-11039/B05-same-model.md` |

| 2026-11-03 | High matplotlib-25332 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `d28c2f87` | `snapshots/harness-high-25332-20261103/CARD.md` |
| 2026-11-03 | High sympy-15609 | 1 | gpt-oss-20b | high | harness freeze | **0** empty after continues | ~n/a | 0 | `9473acc1` | `snapshots/harness-high-15609-20261103/CARD.md` |
| 2026-11-03 | High sympy-15678 | 1 | gpt-oss-20b | high | harness freeze | **0** nonempty not-resolved | ~n/a | 0 | `4279e25e` | `snapshots/harness-high-15678-20261103/CARD.md` |
| 2026-11-04 | High matplotlib-25433 smoke | 1 | gpt-oss-20b | high | planning-steer smoke | **0** empty after continues | ~541s | 0 | `f6427725` | `snapshots/harness-high-25433-20261104/CARD.md` |

**AUDIT-OK:** Historical sqlfluff pass@1=0 retained. Fail rows kept. Unique harness **27/27 closed** (+15347/+14855/+14752/+14580/+14534). B-05 match **6/27** (14382+14855 OC resolved; 14534/14580/14752 OC empty). High freezes **idle** (post-slice grind stopped). Stop blind N / no re-thrash of banned fails. Lite mini-SWE: **70/300** (pred-regen×3 cleared residuals; Hub auth still none). Forbidden: beats OpenCode; “Spockify 80%”; abliterated as product model.

Allowed public line: *Default scored SWE driver is `@spockify/harness`; freeze instance sqlfluff-1625 not-resolved on gpt-oss-20b; same-model OpenCode empty_patch on that instance; Lite board preds graded 70/300 completed-denominator (harness pred-regen×3 on 3 residuals).*

Leap + P1 artifacts: `snapshots/leap-20260916/`, `snapshots/p1-roadmap-20261030/`, `packs/canary-v1.json`, `scripts/bench/run_harness_swe_one.py`, `scripts/bench/run_opencode_swe_one.py`, `packages/spockify-harness/`, `docs/HARNESS.md`.

## 9. Suggested next measurement

1. ~~Lite Accept Partial **70/300**~~ **done** — park full-board. Hub login before any large regrade (needs Tim creds; skipped for now).
2. B-05 only on **new** harness resolves (board **6/27**; gaps filled). High queue **parked** — do not resume empties; deferred smoke `matplotlib-25433` already ran (empty fail kept).
3. ~~Marketing readiness~~ **done** — Allowed public line only; G8 Red; no Terminal Bench while P1 open; Partial gates restated without greenwash.
4. ~~**Harness quality** (sqlfluff / planning)~~ **steer + smoke done (2026-11-04)** — taxonomy [`TAXONOMY.md`](../snapshots/p1-roadmap-20261030/TAXONOMY.md); F2P-body + wrong-file early stop; High smoke `matplotlib-25433` empty not-resolved. Do not re-run sqlfluff-1625 / blind N / gold-prompt salvage. Next: proven gate bug only or B-05 on new resolve; plan SoT in `snapshots/p1-roadmap-20261030/SUMMARY.md`.
5. ~~**Partial gate evidence (ops)**~~ **done (2026-11-04)** — PHASE4-GREEN; canary `max_rounds=1`; SBOM verify; G8 pilot-rehearsal local ok (G8 still Red). G0/G3–G7 stay Partial; Phase 5 Partial; G1-09 waived ≠ pentest. No board % change.
6. ~~**Canary red policy → SoT docs**~~ **done (2026-11-04)** — red→revert (no prompt-salvage) in HARNESS / PRODUCTION_READINESS / BENCH; no gate promote.
6. **Tim-blocked / score-parked next** — Hub auth; High unpark; B-05 on new harness resolve only; optional independent G1-09 pentest.

---

*Last updated 2026-11-04 (P1: unique 27/27 closed; B-05 6/27; Lite 70/300 Partial parked; Partial gate ops + canary red policy docs stamped; High parked).*
