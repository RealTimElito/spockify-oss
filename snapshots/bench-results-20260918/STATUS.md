# SWE-bench Lite full board — STATUS

**Updated:** 2026-09-18 16:18 CEST  
**Verdict:** healthy progressive run — **do not restart**

## Progress

| Metric | Value |
|--------|-------|
| Preds (nonempty `diff --git`) | **75 / 300** |
| Rate (overall) | ~4.2 instances/h |
| ETA | ~54 h (order-of-magnitude) |
| Model | `gpt-oss-20b` via Spark LiteLLM |
| Workers | 1 |
| Host | Spock amd64 Docker + Spark `:24001` PF |
| Twin | down |
| pass@1 | **pending** official `swebench.harness` eval |

## Detached processes (leave alone)

| Role | PID (approx; re-check with `pgrep`) | Command |
|------|-------------------------------------|---------|
| Board launcher | `1415865` / `1415879` | `bash scripts/bench/run_lite_board.sh` |
| Harness | `1416126` | `python -m run_mini_swe swebench … --subset lite --workers 1` |
| Monitor | `3496511` | `scripts/bench/monitor_lite_board.sh` |
| LiteLLM PF | ssh on Spock → `127.0.0.1:24001` | Spark `svc/litellm:4000` |

Output dir: `/workspace/spockify/bench-out/lite-full-20260917/`

## Tail / check

```bash
# Live board + agent chatter
tail -f /workspace/spockify/bench-out/lite-full-20260917/board.log

# 2-min health lines (alive, preds, container, disk)
tail -f /workspace/spockify/bench-out/lite-full-20260917/monitor.log

# Preds count
python3 -c "import json; d=json.load(open('bench-out/lite-full-20260917/preds.json')); print(len(d), sum(1 for v in d.values() if (v.get('model_patch')or'').startswith('diff --git')))"

# Still running?
pgrep -af 'run_mini_swe swebench|run_lite_board'
docker ps --filter name=minisweagent --format '{{.Names}} {{.Status}}'
```

## Resume (only if dead and preds &lt; 300)

```bash
export SPOCKIFY_BASE_URL=http://127.0.0.1:24001
export SPOCKIFY_BENCH_OUTPUT=/workspace/spockify/bench-out/lite-full-20260917
export SPOCKIFY_BENCH_MODEL=gpt-oss-20b
export SPOCKIFY_BENCH_WORKERS=1
export SPOCKIFY_BENCH_WALL_SEC=1209600
# Ensure Spark LiteLLM key + :24001 PF first, then:
nohup bash scripts/bench/run_lite_board.sh \
  >> /workspace/spockify/bench-out/lite-full-20260917/nohup-board.out 2>&1 &
echo $! > /workspace/spockify/snapshots/bench-results-20260918/board.pid
nohup bash scripts/bench/monitor_lite_board.sh \
  /workspace/spockify/bench-out/lite-full-20260917 \
  >> /workspace/spockify/bench-out/lite-full-20260917/monitor.nohup 2>&1 &
```

Resume is **preds.json key-skip** safe — do not wipe `bench-out/lite-full-20260917/`.

## When 300/300

```bash
bash scripts/bench/eval_lite_preds.sh \
  bench-out/lite-full-20260917/preds.json \
  spockify-lite-20260918
# Then write honest pass@1 into RESULTS.md and commit+push private+OSS.
```

## Notes from stalled agents

- Prior Cursor agents ([f21df7cf](f21df7cf-6632-4158-a58c-982031d96e5c), [b038da7c](b038da7c-5d11-466e-95f9-dfb98bcb619c)) died on multi-hour `AwaitShell` resumes — board kept running detached.
- Checkpoint at stall: ~37–59/300; now **73/300**.
- GPU guard periodically stops chat residents (`gemma4`, `nemotron`, …) so `gpt-oss:20b` stays available.
