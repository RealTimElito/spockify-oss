# Spockify CLI

Claude Code–style coding agent for Spockify. Uses the same models/API as the IDE, with **device link + code** login.

## Install

```bash
cd packages/spockify-ide-client && npm install && npm run build
cd ../spockify-cli && npm install && npm run build
npm link   # optional: puts `spockify` on PATH
```

Or run without linking:

```bash
npx tsx packages/spockify-cli/src/index.ts
```

## Login (link + code)

```bash
spockify login
```

1. Terminal shows a short code (`ABCD-EFGH`) and opens the activate URL  
2. Sign in at [spockify.eu](https://spockify.eu) if needed  
3. Enter the code → **Approve**  
4. CLI receives a LiteLLM virtual key and stores it in `~/.config/spockify/credentials.json`

Requires OpenWebUI with the CLI device routes deployed (`/api/v1/spockify/cli/...`).

**Local OSS / air-gapped compose** (auto-detects `WEBUI_URL`, then `http://127.0.0.1:3080` / `:4000` when `SPOCKIFY_BASE_URL` is unset — cloud `https://spockify.eu` is only the last resort):

```bash
# optional explicit override:
export SPOCKIFY_BASE_URL=http://127.0.0.1:3080   # or WEBUI_URL from compose .env
# from another machine on the LAN:
# export SPOCKIFY_BASE_URL=http://10.0.0.10x.x:3080
spockify login --base-url "$SPOCKIFY_BASE_URL"
spockify models                                  # live LiteLLM/OWUI catalog
```

Fallback: `export SPOCKIFY_API_KEY=sk-…` or `spockify --api-key sk-…`

## Usage

```bash
spockify                          # REPL
spockify --tui / spockify tui     # fullscreen TUI (mouse + settings)
spockify "add tests for auth.ts"  # one-shot
spockify --ask "how does X work?" # read-only
spockify --yolo "refactor foo"    # auto-approve writes/shell (80-turn horizon)
spockify --max-turns 64 "…"       # override loop budget (or SPOCKIFY_MAX_TURNS)
spockify --model gpt-oss-20b
spockify --model qwen3-coder-30b-a3b   # lab pin → local Ollama tag when pulled
spockify models                   # list models from the live stack
spockify model lab                # list unpublished lab ids (does not pin)
spockify lab                      # lab-mode REPL (closed-loop per turn)
spockify lab models               # lab dual-role aliases (orch/exec)
spockify lab "add tests for foo"  # one-shot closed-loop orch → parallel exec
spockify bench dry-run            # probe LiteLLM for coding evals
spockify bench smoke              # one coding completion
spockify bench swe --slice 0:1    # SWE-bench Lite via mini-SWE-agent (docs/BENCH.md)
spockify whoami
spockify logout
spockify pentest-eval                 # evaluation TUI (same screen as --tui)
spockify pentest-eval repl            # evaluation CLI (boxed input, tool cards)
spockify pentest-eval run --src ./src # one planner run, then a findings report
```

Evaluation harness (cells, models, thinking, pin): [evaluations/agentic-pentest-harness/README.md](../../evaluations/agentic-pentest-harness/README.md). Operator notes (skills, flags, registered actions): [docs/PENTEST_EVAL.md](../../docs/PENTEST_EVAL.md). Broker accept is not execution; `registered_action` + `pentest_exec` is.

REPL slash commands: `/ask` `/agent` `/yolo` `/model` `/think` `/mode` `/status` `/clear` `/exit`

- **`/think`** — cycle thinking Off→Low→Medium→High→Heavy (or `/think high`); status line shows the level; sends `spockify_thinking` to the router (High/Medium may SPAWN).
- Lab REPL status shows live `Rk/N · phase` while the harness runs, plus a done footer with wall time.
- Lab REPL **`/think`** cycles the same Off→Heavy chip; sets `SPOCKIFY_LAB_*_THINK` for the harness (Heavy maps to high think — not the chat Heavy ensemble).

Coding models (Auto vs `--model`, Lab models section, session picker): [docs/CODING_MODELS.md](../../docs/CODING_MODELS.md). Omit `--model` for Auto (20b think=off, or a tool-less recommend to 120b think=high). Pin Devstral/Qwen with `--model <id>` or `/model` — not `spockify lab`.

**Lab twin dual-role:** point at LiteLLM NodePort or OWUI, then use `lab-orchestrator` / `lab-executor` in `/model`, or `spockify lab` for the closed-loop harness (`packages/spockify-lab-agents`). That loop is not how you reach Devstral/Qwen. Remap backends on the twin with `scripts/lab-set-dual-roles.sh`.

```bash
export SPOCKIFY_LAB_HOST=<twin-ip>   # or SPOCKIFY_BASE_URL=http://<twin>:30400
export LITELLM_MASTER_KEY=…          # from twin secret
spockify lab                         # interactive lab mode
spockify lab models
spockify lab "refactor the CLI help" --orch lab-orchestrator --exec lab-executor
spockify bench dry-run
spockify bench swe --subset lite --slice 0:1 --model gpt-oss-20b --workers 1
```

Coding benches: [docs/BENCH.md](../../docs/BENCH.md) (`spockify bench` / `scripts/run-swebench.sh`). Twin or compose; local models only.

**Lab mode** (`spockify lab`): status shows `orch → exec · lab · rounds N · ×workers`; each prompt runs plan → parallel exec → review with live round banners, streamed orch/exec text (and thinking when the API sends it), and wait spinners during model load. Slash: `/help` `/rounds` (selector) `/orch` `/exec` `/workers` `/models` `/exit`. Flags `--orch` / `--exec` / `--max-rounds` / `--rounds` / `--workers` before the REPL. Ctrl+C exits immediately.

**Horizon:** Agent default **48** turns; `--yolo` **80**; Ask **12**. Cap **80**.

**TUI mode** (`--tui`): alternate-screen layout with chat + session sidebar. Click model/mode/perm or **Settings** (`s`). Keys: `enter` send · scroll · `q` quit · `esc` close modal.

**Evaluation console** (`spockify pentest-eval`): fullscreen operator view over the air-gapped evaluation broker in `evaluations/agentic-pentest-harness`. A Spockify model can take the agent seat; its tools are only `eval_status`, `eval_propose`, `eval_pin_endpoint`, `eval_connect`, `eval_submit_finding`, `eval_submit_report`, and `eval_health`. Coding shell tools are not registered. `/kill` stops the session. `pentest-eval drill` and `pentest-eval run-reference` run without a model.

## Tools

| Tool | Purpose |
|------|---------|
| `read_file` | Read workspace files |
| `write_file` | Create/overwrite files |
| `edit_file` | Exact string replace |
| `grep` | Content search (`rg` or Node) |
| `glob_file_search` | Find by glob |
| `shell` | `bash -lc` in workspace cwd |

## Auth API (server)

| Endpoint | Auth | Role |
|----------|------|------|
| `POST /api/v1/spockify/cli/device/code` | none | Start device session |
| `GET /api/v1/spockify/cli/activate` | browser | Enter code + approve UI |
| `POST /api/v1/spockify/cli/device/approve` | OWUI user | Mint LiteLLM key |
| `POST /api/v1/spockify/cli/device/token` | none | CLI poll for key |
