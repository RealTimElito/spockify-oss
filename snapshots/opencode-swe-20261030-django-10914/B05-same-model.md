# B-05 same-model — django__django-10914 × gpt-oss-20b

| Side | Outcome | Patch |
|------|---------|-------|
| `@spockify/harness` | **resolved** | 625 B |
| OpenCode 1.18.31 | **resolved** | 625 B (**byte-identical** to harness) |

- Dataset: `SWE-bench/SWE-bench_Lite` test · official swebench eval
- OpenCode: instructions + `--dir` + `--auto` via `spockify-litellm` → Spark `:24001`
- Cards: `snapshots/harness-swe-runHarness-20261030-django__django-10914/CARD.md`, `snapshots/opencode-swe-20261030-django-10914/CARD.md`
- **Parity evidence on this cell** — not a board %; not “beats OpenCode”
- Historical sqlfluff pass@1=0 and sqlfluff OpenCode empty/nonempty fails **unchanged**
