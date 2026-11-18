# Smoke-continue reliability — django__django-11422 (smokecont3)

- Hypothesis: FAIL_TO_PASS local smoke never returned `ok=false` because (1) pytest/`-k` cannot drive Django, (2) host conda was used instead of repo `.venv`, (3) **SWE `test_patch` was never applied**, so the FAIL_TO_PASS method was missing.
- Model: `gpt-oss-20b` · Think: `high` · Lite
- Scored run id: `20261031-smokecont3-retry-django__django-11422` (PF on Spock; first in-flight abort archived)

## Code changes (`1e9e2877`)

| Lever | Change |
|-------|--------|
| test_patch | Apply SWE `test_patch` after clone; commit as baseline; **never** gold/fix patch |
| Django map | `test_x (mod.Class)` → `mod.Class.test_x` via `tests/runtests.py --settings=test_sqlite` |
| .venv | Create/repair smoke venv with pip; install editable + tests/requirements; refuse host python fallback |
| harness `run_tests` | Prefer `.venv/bin/python`; default Django to `tests/runtests.py`; allowlist updated |

## Local smoke evidence (no model)

Instance `django__django-11422` @ `df46b329e0900e9e…`, FAIL_TO_PASS
`test_main_module_is_resolved (utils_tests.test_autoreload.TestIterModulesAndFiles)`:

| Step | `swe_smoke.ok` | Notes |
|------|----------------|-------|
| base + test_patch | **False** | real `FAILED (failures=1)` via django-runtests in `.venv` |
| + gold patch (sanity only) | **True** | proves smoke can flip; gold **not** used in agent path |

## Agent re-probe (scored, PF `:24001`)

- Outcome: **resolved** (official swebench report; wall ~458s)
- `swe_test_patch.applied=true` (589 bytes)
- `swe_smoke_venv` → repo `.venv/bin/python`
- Pass1: empty patch → `swe_empty_patch_continue` (`diff_bytes_pass1=0`, 16 turns)
- After continue: nonempty patch (`1931` bytes) on `django/utils/autoreload.py`
- Post-run `swe_smoke.ok=true` (django-runtests FAIL_TO_PASS green) — **smoke-continue (`ok=false` inject) did not fire**; empty-diff continue was the continue that mattered this run
- `continue_used=true` (empty-patch path)
- Traces: `bench-out/harness-swe-runHarness-20261031-smokecont3-retry-django__django-11422/`
- Auto card: `snapshots/harness-swe-runHarness-20261031-smokecont3-retry-django__django-11422/CARD.md`

Prior smokecont1/2 + N=5c **fail rows kept**.

## Scores (honest)

- B-04 unique harness resolves: **5/27** (add `django__django-11422`; was 4/27: 10914, 12907, 11039, 11133)
- B-05 OpenCode match cells: unchanged
- sqlfluff pass@1=0 historical row: **kept**
- N=1 freeze ≠ board %
- Evidence fix: `1e9e2877`; probe on `603afbe3`; card: `cbbacf82`
