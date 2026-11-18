# Bench results — 2026-09-17 (full SWE-bench Lite board IN PROGRESS)

## Setup

| Field | Value |
|-------|-------|
| Host | Spock amd64 Docker + Spark LiteLLM (`:24001` PF) |
| Twin | down |
| Model | **gpt-oss-20b** (120b not used — VRAM reserved for stability) |
| Split | `test` (300 instances) |
| Workers | 1 |
| Harness | mini-swe-agent 1.14.4 + Spockify adapters (LEAP-020/021/024 + board fixes) |
| Output | `bench-out/lite-full-20260917/` (gitignored trajs) |
| Restore | see `RESTORE-AFTER-BENCH.md` |

## GPU prep (Spark)

- Unloaded `llama3.1:8b` / `llama3.2:3b`; kept `gpt-oss:20b` + XTTS
- Scaled `vllm-tab` → 0; `comfyui` stayed 0
- ~87Gi available after free

## Stability fixes this board

1. Full-board launcher: `--slice all`, `--split test`, 14d wall, resume via `preds.json`
2. Disk prune watchdog — **fixed** force-rm of *running* minisweagent containers
3. Submit gate: refuse COMPLETE when `git diff` empty (blocks `cat: patch.txt` false patches)
4. Prior LEAP guards retained (empty-stop, tool-parse 500 soft-fail, grep -R rewrite, py_compile)

## Agent progress (live — update at end)

Interim snapshot while board runs. **Not a final pass@1.**

| Metric | Value |
|--------|-------|
| Last update | 2026-09-18 16:18 CEST |
| Preds | **84** / 300 (leap-docs checkpoint 2026-09-18; live board continues) |
| Nonempty diffs | 75 |
| Model | gpt-oss-20b |
| Workers | 1 |
| Rate / ETA | ~4.2/h · ~54h remaining |
| Live STATUS | `snapshots/bench-results-20260918/STATUS.md` |
| pass@1 | **pending official swebench.harness eval** |

## Honest scoring policy

- Resolved only after FAIL_TO_PASS / harness report
- Empty / `cat: patch.txt` / infra errors → not-resolved
- No OpenCode or public leaderboard scores invented

## Commands

```bash
# Board (resume-safe)
SPOCKIFY_BASE_URL=http://127.0.0.1:24001 \
  bash scripts/bench/run_lite_board.sh

# Eval when preds complete
bash scripts/bench/eval_lite_preds.sh bench-out/lite-full-20260917/preds.json
```
