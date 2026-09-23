# LEAP-011 — patch format decision

**Chosen legal format:** search-replace blocks (`SEARCH` / `REPLACE`).

**Rejected:** unified diffs (already gated in `shell_tool.apply_writes`).

**Transitional:** full-file `WRITE:` bodies remain accepted so canary-v1 (tips 50–87) stays green. Cutover to reject raw full-file dumps needs a Director ticket after canary proves search-replace on 20b.

## Module

`packages/spockify-lab-agents/spockify_lab_agents/apply_patch.py`

## Tests

`packages/spockify-lab-agents/tests/test_leap_harness.py`
