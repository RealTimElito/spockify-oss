# Overnight SUMMARY — Tim back ~07:02 CEST 2026-09-09

Trail: `snapshots/overnight-20260908/RESULTS.md`  
**Overnight loop stopped.** No commit/push.

## Verdict (what to keep)

**Lab best tip = `50-exec-stream-early-stop-dsu`** on **49** / **47** / **46** / **44** / **42** / **34** foundation (**do not undo 23 / 27 / 29 / 31 / 34 / 42 / 44 / 46 / 47 / 49**; BST eval from 48 keep):

| Keep | Why |
|------|-----|
| **Bootstraps 23–31** | First-turn / docs / rename / missing-imports / preseed fail |
| **WRITE/RUN guards 32–34, 42, 47** | Test block, empty, parentheticals, double-fence, diff reject, fail nudge |
| **Stop pytest / auto-verify 35–36 + reset 46** | Thrash guards |
| **Invent assert-first + filter/nudge 37–46** | Asserts; skip cat/ls/README; WRITE nudge |
| **WRITE-in-fence + keep pytest after WRITE (49)** | Buried WRITE salvage; post-WRITE verify |
| **Exec stream early-stop + max_tokens (50)** | Stop DONE-loop SSE; cap exec tokens (~2304) |
| **EXEC exact-assert (44)** | Honor Key asserts |
| Harder invents | Heap / DSU / codec / BST / MinStack / parens / anagrams / RPN / flatten / roman |
| Harder fixes | Queue / ledger multi-file |

### Eval scoreboard (best overnight walls, quality **10**)

| Eval | Tag | Wall | Notes |
|------|-----|------|-------|
| Anagrams + boot | `50-anagrams-boot` | **~9s** | |
| Docs | `50-docs-regress` | **~11s** | |
| Shop / calc / flatten | `50` | **~13–14s** | |
| RPN + boot | `50-rpn-boot` | **~13s** | |
| Rate | `50-rate-regress` | **~16s** | was ~293s stream-loop; `50b` ~54s |
| Codec + boot | `50-codec-boot` | **~16s** | |
| DSU + boot | `50-dsu-boot` | **~22s** | new UF invent |
| Queue | `50-queue-regress` | **~23s** | |
| Invent + boot | `50-invent-boot` | **~25s** | variance ~14–25s |
| BST / heap | `50` | **~26 / ~30s** | |
| Micro propose | `50-micro-propose` | **~120s** | orch-only (was ~66–93s) |

## Snapshot map (tip)

| Dir | Keep? |
|-----|-------|
| `…/50-exec-stream-early-stop-dsu/` | **BEST tip** |
| `…/49-heap-write-in-fence-pytest/` | keep |
| `…/47`…`46`…`44`…`42`…`34` + `23/27/29/31` | foundation |

## Not done / caveats

- **No commit/push** (uncommitted lab package + overnight tree)
- SWE aarch64 / mid-thought SPAWN left alone (twin-only if revisited)
- Rate still has twin/model variance (`50` ~16s vs `50b` ~54s) — early-stop fixed the ~293s DONE-loop class
- `50-dsu-noboot` interrupted when Tim returned
- Voice / Tab / FIM / Heavy untouched; no policy harden

## Land this (recommended)

1. Review + commit `packages/spockify-lab-agents/` (+ overnight evals/snapshots if wanted)
2. Sync / install lab package on twin; spot-check invent-boot + rate
3. Leave mid-thought / SWE for a dedicated pass

## Paths

- Summary: `snapshots/overnight-20260908/SUMMARY.md`
- Best tip: `snapshots/overnight-20260908/50-exec-stream-early-stop-dsu/`
- Live code: `packages/spockify-lab-agents/spockify_lab_agents/{loop.py,shell_tool.py,llm.py}`
