# skill-trace-jsonl

## Purpose
Emit/validate one turn object per schema-trace.v1.

## Inputs
JSONL path(s).

## Outputs
`ACCEPT n/n` or `REJECT` with line errors.

## Commands
```bash
python3 scripts/bench/validate_trace_jsonl.py path/to/run.jsonl
```

## Fail codes
`1` reject; `2` schema missing

## May touch
trace files, validator

## Must not touch
secrets into OSS snapshots (redact first)

## Example
Required: `model`, `think`, `stop_reason`, `wall_s`.
