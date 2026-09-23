# skill-git-txn

## Purpose
Snapshot HEAD before first WRITE; `reset --hard` on red oracle; optional single commit/stash on green (Keep path).

## Inputs
- Repo cwd for the job
- Oracle green/red

## Outputs
- Snapshot ref / stash id
- Clean tree after red reset

## Commands
```bash
python3 -c 'from spockify_lab_agents.git_txn import snapshot, reset_hard; ...'
pytest packages/spockify-lab-agents/tests/test_leap_harness.py -q -k git
```

## Fail codes
- `0` ok
- `1` not a git repo / snapshot failed
- `2` reset failed

## May touch
Job cwd `.git` via helpers only; `git_txn.py`

## Must not touch
Unrelated repos, Ollama models, prod k8s

## Example
```
snapshot=leap-pre-write-a1b2
reset_hard: clean (red pytest)
```
