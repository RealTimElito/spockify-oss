# Live ws_cascade without scripted edit

- Date: 2026-09-19T08:19:40.119Z
- Model: `gpt-oss-20b`
- Entry: `runHarness` only (no card-runner scripted edit_file)
- Result: **Y**
- before_green=false after_green=true hello_in_file=true
- cascade_L=0 edit_applied=true wall_s=144
- Scripted edit injection: **no**

Model read then exact-matched (L0) including trailing spaces — pytest flipped red→green without SCRIPTED_EDIT. Not an L1 whitespace-norm proof; do not add a new cascade layer.

Phase 4: lab default is runHarness (tip-50 only via SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS=1).
