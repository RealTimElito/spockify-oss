# Highfix — django__django-12284 (stub-reject hypothesis)

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock LiteLLM `:24001`
- Run: `20261031-highfix-django__django-12284` on `9d88ab62` (smoke-ImportError + `_noop` reject shipped `ad06744c`)

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-12284` | **not-resolved** | **empty** (0 B) |

- Empty-diff continue fired; smoke saw baseline FAIL; no smoke-continue (empty).
- Stub-reject path **idle** (no `_noop` attempt). Residual: **FAIL_TO_PASS targeting** (never opened `tests/model_fields/tests.py` → fields/`get_*_display`).
- Prior High fail row **kept**. Do **not** thrash 12284 again without the new path-hint.
- Unique B-04 this probe: unchanged (board stamped **8/27** via prior highfix-12453 resolve).

Per-instance: `snapshots/harness-swe-runHarness-20261031-highfix-django__django-12284/CARD.md`
