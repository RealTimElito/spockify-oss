# Harness Profile v0

Contract for third-party coding loops that plug into Spockify CLI / IDE / lab.
**Default remains Spockify `runHarness`.** Plugins are out-of-process; Spockify
never vendors a foreign AgentCore into `services/`.

Gated on: `docs/HARNESS.md` Phase 4 **Done**, `check_harness_clients.sh`
`PHASE4-GREEN`, canary green on the default kernel.

## What Spockify always owns

- Workspace root, `.spockify/`, git, shadow apply UI
- ModelTransport (LiteLLM)
- Permission prompts + session grant store
- Event render (TUI / IDE / lab HUD)

## What a plugin may own

- Turn loop, tool batching, compact, child agents
- Native tools vs fences
- Its own loop-detect / kill internals
- Extra tools **only** if they go through HostTools (or declare `tools: plugin`)

## Required capabilities

| Capability | Required | Notes |
|---|---|---|
| stdio JSONL (or local HTTP) | Yes | One process per session |
| Events: `text`, `toolStart`, `toolResult`, `done`, `error` | Yes | Map foreign names in the adapter |
| Abort / kill | Yes | SIGINT → process; plugin SIGTERM children |
| Workspace root argument | Yes | Never assume cwd is the repo |
| Model base URL + key + model id | Yes | OpenAI-compatible |
| `toolStart` includes name + args | Yes | IDE confirm path |

Nice-to-have: `toolKilled`, `loopWarning`, `compact`, `taskSpawn`, plan vs build,
native apply_patch.

Out of profile v0: MCP / browser / DuckDB.

JSON Schema for events: `packages/spockify-harness/schema/harness-event.v0.json`
(matches `HarnessEvent` in `packages/spockify-harness/src/types.ts`).

## Wire format (stdio JSONL)

**Host → plugin (hello):**

```json
{"v":0,"cmd":"run","cwd":"/path","transport":{"baseUrl":"...","apiKey":"...","model":"..."},"policy":{"mode":"build","maxTurns":48,"writeRequiresRead":true},"messages":[{"role":"user","content":"..."}],"sessionId":"..."}
```

**Plugin → host (events):** profile events with `"v":0,"t":"<type>"` **or** native
`HarnessEvent` objects (`{"type":"text",...}`). Host accepts both.

**Host → plugin (during run):** `{"v":0,"cmd":"abort|grant|deny|user","id":"..."}`.

## Install story

Default: `harness: spockify` (in-process `runHarness`).

User adds `~/.spockify/harnesses/<id>.yaml` (or project `.spockify/harness.yaml`):

```yaml
id: example
command: my-harness
args: ["--workspace", "{cwd}"]
env:
  OPENAI_BASE_URL: "{transport.baseUrl}"
  OPENAI_API_KEY: "{transport.apiKey}"
  OPENAI_MODEL: "{transport.model}"
profile: v0
tools: host
label: Example harness
```

CLI:

```bash
spockify harness list
spockify harness test <id>   # three 20b-card fixtures; card includes harness id
spockify harness use <id>    # set default in ~/.spockify/config.json
spockify --harness spockify  # unchanged default
```

Missing plugin command → error + install hint → **fall back to Spockify kernel**
(never hang).

## HostTools (plugin may call back)

`read_file`, `grep`, `glob`, `apply_patch`, `write_file` (READ_REQUIRED on host),
`shell` (classifier + grants), `run_tests`, `git_snapshot`, `git_reset`.

If the plugin shells around HostTools, label the session YOLO-equivalent.

## Optional external adapter

`packages/spockify-harness-adapter-external` — thin argv/env wrapper that spawns a
user binary with `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_MODEL`, translates
log/SSE into profile events. **Not** in the default image; **not** under
`services/`.

## Author guidelines

1. Do one thing: run the turn loop. Do not start your own Ollama.
2. Honor abort (process-group kill).
3. Prefer HostTools for writes.
4. Emit known tool names or document aliases.
5. Never phone home. Workspace only.
6. License: your binary stays yours.

## Scoring

Published cards name `harness id`. Mixing third-party rows into a Spockify % is
forbidden. Canary pack always runs on the default kernel.
