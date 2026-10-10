# skill-infra-fail

## Purpose
Classify image-pull / OOM / timeout / unreachable LiteLLM vs agent-fail.

## Inputs
Bench logs, docker pull errors, wall clocks.

## Outputs
`resolved` | `not-resolved` | `infra-fail`; optional `INFRA-BLOCK` / `HOST-BLOCK`.

## Commands
Inspect `bench-out/` logs; write card with `infra_fail: true` when applicable.

## Fail codes
Infra-fail must not count as model fail on cards.

## May touch
HOST_FLAG, cards, INFRA notes

## Must not touch
Prompt retunes while INFRA-BLOCK

## Example
48h pull wall → INFRA-BLOCK; A4 stops.
