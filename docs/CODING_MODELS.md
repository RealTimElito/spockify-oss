# Coding models (CLI / IDE)

One `spockify` binary. Agent/build uses the same picker for prod pins and
unpublished lab ids. There is no second CLI and no `SPOCKIFY_LAB=1` switch
for Devstral or Qwen.

Catalog source: `packages/spockify-harness/catalog/coding-models.v1.json`
(mirrored in `CODING_CATALOG_V1`). Phase 5 stays **Partial**. Lab rows stay
`promoted: false` until a fixture CARD exists. Do not promote them to prod.
Do not use DeepSeek as orchestrator.

## Same picker

| Surface | How you pin |
|---------|-------------|
| CLI flag | `spockify --model <id>` |
| CLI REPL / TUI | `/model` or the model list (Coding pins + **Lab models**) |
| IDE Chat / Composer | model dropdown — Auto, 20b, 120b, then **Lab models** |

`spockify model lab` only **lists** unpublished candidates. It does not pin
and it does not pull weights. Pinning is `--model` / the dropdown.

```bash
spockify --model gpt-oss-20b "fix the test"
spockify --model gpt-oss-120b --think high "refactor the package"
spockify --model qwen3-coder-30b-a3b "try the lab coder"
spockify model lab          # list helper only
```

## Prod pins vs Lab models

**Prod Auto** (what the session picker may choose) is only:

- `gpt-oss-20b`
- `gpt-oss-120b`

**Lab models** (`pool: lab` or unpublished `lab_models`, `promoted: false`):

| Id | Notes |
|----|--------|
| `devstral-small-2` | Unpublished lab candidate |
| `devstral-2` | Unpublished. Header warns **evicts 120b-hot** |
| `qwen3-coder-30b-a3b` | Instruct **Q4 or Q8** canonical (not fp16) |

Auto **never** selects `pool: lab` or any unpublished lab id. Selecting
`devstral-2` yourself is a user pin; the HUD adds `evicts 120b-hot`.

Qwen catalog id stays `qwen3-coder-30b-a3b`. A host may have
`qwen3-coder:30b-a3b-q4_K_M` (or Instruct Q8) pulled; do not set fp16 as
the catalog id. Do not treat a pull as a prod pin.

`--model qwen3-coder-30b-a3b` maps that catalog id to the Ollama tag and
talks to **local Ollama** (`http://127.0.0.1:11434`) when the tag is
pulled. It is not on `https://spockify.eu`. Saved cloud creds must not
send the lab id to prod — that is a hard error, not a raw 400.
`think=off` omits Ollama `think=` for Qwen Instruct (do not send
gpt-oss think flags). Manual override:

```bash
spockify --model qwen3-coder-30b-a3b --think off "try the lab coder"
# equivalent explicit host:
spockify --base-url http://127.0.0.1:11434 --model qwen3-coder-30b-a3b
```

## Auto vs an explicit pin

**Auto** (`spockify-auto`, or omit `--model`):

1. Once per Agent/build session, **before tools**, `@spockify/harness`
   `pickSessionModel` runs.
2. Default: **`gpt-oss-20b` think=off**.
3. A tool-less LiteLLM recommend call (no shell, no workspace tools) may
   return `{model, think}` — only `gpt-oss-20b`/`gpt-oss-120b`. Multi-file /
   failing tests / architecture → `gpt-oss-120b` think=high. Single-file /
   explain → stay 20b think=off.
4. If LiteLLM is unreachable, keep the default. There is **no** keyword
   fallback (`if prompt contains "hard"`).
5. Header: `auto → <tag> think=<level>` (via `formatSessionPin`).
6. After the first write (`apply_patch` / `write_file` / `edit_file`), the
   worker is frozen for the session. Auto cannot swap. The header drops the
   `auto →` prefix and shows the real tag.

**User `--model <id>`** (including a lab id) skips the picker entirely.
`--think` with Auto overlays think only; the model still comes from
recommend or the 20b default.

```text
# Auto (no --model)
harness=spockify · auto → gpt-oss-20b think=off

# After first write, or a user pin
harness=spockify · gpt-oss-20b · think=off
harness=spockify · devstral-2 · think=off · evicts 120b-hot
```

Ask/plan with Auto uses the 20b/off default and does not spend a recommend
call.

## What the picker is not

- Returns `{model, think}` only. It does **not** get shell or file tools.
- Chat router, Heavy ensemble, and mid-thought SPAWN stay **chat-only**
  (`docs/MIDTHOUGHT_SPAWN.md`). Coding spawn/doer stay in `@spockify/harness`
  (`docs/HARNESS.md`). Do not import `midthought_spawn.py` for file/shell.
- The router never executes workspace tools.
- Product chat/router images stay pinned; this catalog/picker work does not bump them.

## IDE

Default model is `spockify-auto` so the session picker can run. Lab dual-role
aliases (`lab-orchestrator` / `lab-executor`) are for the **Lab Agents**
command, not for Auto and not the way to reach Devstral/Qwen.

Coding dropdown: Auto + prod 20b/120b + **Lab models** section. After the
first write, the session stays on the resolved tag.

See also [`docs/HARNESS.md`](HARNESS.md).
