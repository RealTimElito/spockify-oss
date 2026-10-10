# skill-swe-one-instance

## Purpose
Complete exactly one SWE-bench Lite instance (slice 0:1, workers 1) with trajectory folder.

## Inputs
Pinned mini-swe-agent, `{{task}}` template, LiteLLM base, model `gpt-oss-20b`.

## Outputs
`bench-out/<stamp>/` trajectory; redacted summary under `snapshots/leap-20260916/cards/`.

## Commands
```bash
./scripts/bench/lint_swe_template.sh
./scripts/run-swebench.sh swe --install --subset lite --slice 0:1 --workers 1 \
  --model gpt-oss-20b --base-url http://127.0.0.1:24001
```

## Fail codes
- resolved / not-resolved / infra-fail (pull, OOM, timeout)
- INFRA-BLOCK if pulls fail 48h — do not retune prompts

## May touch
`scripts/bench/*`, `bench-out/`, pin docs

## Must not touch
`loop.py` to “help” one instance; invents; think raise without ticket

## Example
Classify outcome before handing A8 a 120b row.
