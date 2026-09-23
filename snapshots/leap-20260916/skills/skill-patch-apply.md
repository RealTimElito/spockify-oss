# skill-patch-apply

## Purpose
Apply one frozen legal write format (search-replace). Reject unified-diff and raw full-file dumps with a harness note.

## Inputs
- WRITE body from exec
- `PATCH_FORMAT.md` / `apply_patch.py` contract

## Outputs
- Applied hunks or reject reason string
- Trace `writes[]` entry

## Commands
```bash
python3 -c 'from spockify_lab_agents.apply_patch import apply_search_replace; ...'
pytest packages/spockify-lab-agents/tests/test_leap_harness.py -q -k patch
```

## Fail codes
- `0` applied
- `1` reject-other / parse error
- `2` file budget exceeded

## May touch
`packages/spockify-lab-agents/spockify_lab_agents/apply_patch.py`, lab fixtures under ticket cwd

## Must not touch
Router pick logic, invent fixtures, model defaults, IDE chrome (except A15 applicator glue after API freeze)

## Example
```
OK wrote rate.py (1 hunk)
REJECT: unified diff not allowed; use search-replace
```
