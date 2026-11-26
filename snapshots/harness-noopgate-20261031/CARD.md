# Harness noop-apply gate smoke — 20261031

- Model: `gpt-oss-20b` · Driver: `@spockify/harness` runHarness
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Change: identical SEARCH/REPLACE (and content-unchanged apply/edit/write) **must not** call `noteWrite` / count as a successful write
- Evidence commit: `850d775e`
- Run id prefix: `20261031-noopgate-*`
- Wall: ~14m sequential

## Scores

| Instance | Outcome | Patch | Notes |
|----------|---------|-------|-------|
| `django__django-12125` | **not-resolved** | empty | 0 successful writes; `run_tests` blocked ×6 before write |
| `astropy__astropy-6938` | **not-resolved** | empty | 0 successful writes; `run_tests` blocked ×12 before write |

- **This smoke pass@1: 0/2** (fail rows kept; prior N=5b empties kept)
- **Cumulative unique harness freezes: 3/15** unchanged (resolved-any still 10914, 12907, 11039)
- N=5 / N=5b nonempty fails / sqlfluff **not** re-run

## Gate evidence

- Unit: `noop write gate` in `packages/spockify-harness/test/harness.test.ts` (identical SEARCH/REPLACE → fail; `writtenRelPaths` empty; `run_tests` blocked)
- Live: no `run_tests` ok before a real write on either id (`leaked_ok=0`)
- This smoke did not hit a noop apply (model never landed a successful write); residual gap is still empty final patch on these two ids

Per-instance: `snapshots/harness-swe-runHarness-20261031-noopgate-*/CARD.md`
