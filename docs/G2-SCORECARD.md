# G2 verified-agent scorecard (live 20b card)

Offline kernel SCORECARD-10 is **10/10** (`packages/spockify-harness/test/scorecard10.test.ts`).
That is not SWE.

## Live GPU (2026-10-17)

Operator override for this run only: unload the gpt-oss pins with Ollama HTTP
`keep_alive=0` (not `ollama stop`), leave chat up, keep video POST 503, do not
scale the Comfy replica. After the card, pins were restored with
`keep_alive=-1`.

Command: `npx tsx packages/spockify-harness/scripts/run-20b-card.ts`
(`runHarness` × `gpt-oss-20b` × three fixtures). Card:
[`snapshots/harness-20b-card-20261017/CARD.md`](../snapshots/harness-20b-card-20261017/CARD.md).

| fixture | resolved | repair-turn | cascade L | wall s |
|---------|----------|-------------|-----------|--------|
| rate_write_gate | Y | N | — | 86 |
| ws_cascade | Y | N | 2 (scripted after model refuse) | 25 |
| fence_repair | Y | Y | — | 14 |

Tree SHA at run: `4c59b3bb`. Offline harness suite the same day: **118 pass / 0 fail**
(includes SCORECARD-10 10/10).

Before unload: two llama-server processes (~62288 MiB + ~12892 MiB) plus ~170 MiB
python (host Comfy hotfix, left running). After unload: only that python.
During the card: `gpt-oss:20b` ~13 GiB. After re-pin: `gpt-oss:20b` and
`gpt-oss:120b` both Forever (`expires_at` year 2319). Video POST with a key
stayed **503**. Chat/OWUI stayed up.

## What this document refuses to claim

- No SWE %, no pass@1 board, no OpenCode / Wichy parity.
- Historical Lite row `sqlfluff__sqlfluff-1625` / gpt-oss-20b **pass@1 = 0**
  stays in `docs/BENCHMARK_COMPARISON.md`.
- Phase 5 stays **Partial** (scored path is still mini-SWE).
- This is a live 20b control-plane card, not a SWE-Verified board.
