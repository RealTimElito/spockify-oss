# skill-litellm-only

## Purpose
Point agent benches at LiteLLM OpenAI-compatible `/v1`, never router `:4100`/`:30100`.

## Inputs
Base URL candidate (compose `:4000`, twin `:30400`, Spark PF).

## Outputs
Resolved LiteLLM base; `/v1/models` + tiny chat ok.

## Commands
```bash
./scripts/run-swebench.sh dry-run --base-url http://127.0.0.1:24001 --model gpt-oss-20b
```

## Fail codes
- unreachable → INFRA-BLOCK
- router URL used → Director reject

## May touch
bench env, port-forward, HOST_FLAG

## Must not touch
router routing code, OWUI chrome

## Example
`docs/BENCH.md` table: LiteLLM primary; router forbidden for SWE.
