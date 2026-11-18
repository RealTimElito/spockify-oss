# B-05 same-model — django__django-12700 × gpt-oss-20b

| Side | Outcome | Patch |
|------|---------|-------|
| `@spockify/harness` (High) | **resolved** | nonempty (1463 B) |
| OpenCode 1.18.31 | **not-resolved** | nonempty (1155 B) |

- Dataset: `SWE-bench/SWE-bench_Lite` test · official swebench eval
- Run: `20261031-b05-opencode-django__django-12700` · Wall ~331s
- **Gap:** harness resolved; OpenCode nonempty wrong on same id/model
- Harness-resolved OpenCode match: **1/6** (10914 yes; 12907/11848/11999 empty; 11422+12700 nonempty fail)
- Not OpenCode superiority; not board parity
- Historical sqlfluff pass@1=0 and prior fail rows unchanged

Harness card: `snapshots/harness-high-12700-20261031/CARD.md`
OpenCode card: `snapshots/opencode-swe-20261031-b05-opencode-django__django-12700/CARD.md`
- Evidence commit: `37ef86647a8101ab920ebb0e082333daedb3b9f7`
