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
spockify --model codestral
spockify models                   # list models from the live stack
spockify whoami
spockify logout
```

REPL slash commands: `/ask` `/agent` `/yolo` `/model` `/mode` `/status` `/clear` `/exit`

**Horizon:** Agent default **48** turns; `--yolo` **80**; Ask **12**. Cap **80**.

**TUI mode** (`--tui`): alternate-screen layout with chat + session sidebar. Click model/mode/perm or **Settings** (`s`). Keys: `enter` send · scroll · `q` quit · `esc` close modal.

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
