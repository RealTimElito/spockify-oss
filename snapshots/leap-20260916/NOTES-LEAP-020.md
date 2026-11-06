# LEAP-020 — gpt-oss / mini-swe empty-content thrash

## Root cause

On Spark LiteLLM, `gpt-oss-20b` answered mini-swe with:

- `finish_reason: tool_calls` on **all** 100 steps of LEAP-009e
- empty `message.content`
- native `container.exec` tool calls (`{"cmd":["bash","-lc",...]}`)
- optional `reasoning_content` prose

mini-swe-agent 1.14 only parses `content` for a single ````bash` fence → perpetual FormatError → `LimitsExceeded` / empty patch.

Phrase “bash tool call” in the old template encouraged native tools.

## Fix

1. `scripts/bench/spockify_litellm_model.py` — `SpockifyLitellmModel` coalesces:
   - content (normalize bare ``` → ```bash)
   - else tool_calls → ```bash fence
   - else reasoning fence / shell-ish last line
2. Template demands ```bash fences; forbids function/tool calls; clearer format_error.
3. `model_kwargs.tool_choice: "none"`.
4. `run-swebench.sh` puts `scripts/bench` (+ output copy) on `PYTHONPATH`.

## Evidence

- Unit tests: `scripts/bench/test_spockify_litellm_model.py` (5 OK)
- Offline: salvage recovers **100/100** empty turns from `leap-009-lite-0-1e` traj
- Live re-run: `bench-out/leap-009-lite-0-1f` (in flight) — container shows real explore (`test/` dir, dialect pycache), not FormatError thrash
