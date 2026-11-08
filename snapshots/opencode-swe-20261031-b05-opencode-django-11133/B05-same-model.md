# B-05 same-model — django__django-11133 × gpt-oss-20b

| Side | Outcome | Patch |
|------|---------|-------|
| `@spockify/harness` (N=5d) | **not-resolved** | nonempty (2448 B) |
| OpenCode 1.18.31 | **not-resolved** | **empty** |

- Dataset: `SWE-bench/SWE-bench_Lite` test · official swebench eval
- **Gap:** harness landed a nonempty patch (still fail); OpenCode empty_patch on same id/model
- Not OpenCode superiority; not board parity
- Prior B-05: django-10914 both resolved; astropy-12907 harness resolve / OpenCode empty
- Historical sqlfluff pass@1=0 and N=5* fail rows unchanged

- Evidence commit: `1c6edadd`
