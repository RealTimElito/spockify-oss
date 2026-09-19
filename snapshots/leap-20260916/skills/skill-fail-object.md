# skill-fail-object

## Purpose
Inject last oracle result as structured `{cmd, exit, tail, failed_nodeids[]}` — not free-text “pytest failed.”

## Inputs
- Pytest / instance test observation text
- Exit code

## Outputs
- Fail-object block appended to exec observations
- Trace `pytest` fields

## Commands
```bash
python3 -c 'from spockify_lab_agents.fail_object import parse_fail_object; ...'
pytest packages/spockify-lab-agents/tests/test_leap_harness.py -q -k fail
```

## Fail codes
- `0` parsed or empty-ok
- `1` schema incomplete (missing exit/tail when red)

## May touch
`fail_object.py`, shell observation formatting

## Must not touch
Invent new eval slugs; invent failed_nodeids when none present

## Example
```
{"cmd":"pytest -q","exit":1,"tail":"... FAILED test_rate.py::test_bad","failed_nodeids":["test_rate.py::test_bad"]}
```
