# spockify-lab-agents

**Lab twin only** (air-gapped Spark twin). Closed-loop coding harness:

`plan → parallel executors → review → iterate`

Benign software work only — no attack / exploit / offensive cyber.

## Roles

| Alias | Role | Remap |
|-------|------|--------|
| `lab-orchestrator` / `lab-plan` | Planner + reviewer | `lab-set-dual-roles.sh` |
| `lab-executor` / `lab-code` | Implementer workers | same |

## Run

```bash
# Laptop → twin LiteLLM NodePort (or on-box :30400)
export SPOCKIFY_BASE_URL=http://<twin-host>:30400
export LITELLM_MASTER_KEY=…   # from twin secret; never commit

./scripts/spockify-lab-agents                 # interactive lab-mode REPL
./scripts/spockify-lab-agents models
./scripts/spockify-lab-agents "add a README section for foo" \
  --orch lab-orchestrator \
  --exec lab-executor \
  --workers 4 \
  --max-rounds 5
# --rounds is an alias for --max-rounds
spockify lab --rounds 8

# Or via Spockify CLI (delegates here):
spockify lab                                  # same REPL
spockify lab "add tests for auth.ts" --orch lab-orchestrator --exec lab-executor
```

Live progress (REPL and one-shot): round banners (`Round k/N · plan|exec|handoff|review`), wait spinners while models load, streamed orchestrator/executor content (and `thinking` when the API returns reasoning deltas), **DONE / OUTPUT** digests after each exec batch, plus continue/stop decisions.

**Ctrl+C** exits the CLI (cancels an in-flight round). Prefer `spockify lab` for the boxed Spockify CLI chrome; bare `spockify-lab-agents` uses a matching banner + `❯` prompt.

Orchestrator/executor prompts prefer **shell for inspection** (`ls`, `rg`, `git status`, …) and forbid inventing throwaway `.py` wrappers for one-liners; create files only for real code/tests/docs.

### Cooperative handoff (back-to-back)

Each round is **plan → exec batch → DONE digests → review**:

1. Executors return **completed work** (`DONE — …`, findings, artifacts) — not a methodology for a later agent.
2. The harness builds structured digests (`status=DONE`, `findings_digest`) and prints a **handoff** banner so you can see what exec produced.
3. Review must **read and use** those digests; only open gaps get new tasks. Follow-ups skip re-plan (no duplicate churn). Empty tasks / `status=done` stops the loop.

### Same ideas as High mid-thought SPAWN

Lab loop and chat mid-thought (phases **A–D**, see `docs/MIDTHOUGHT_SPAWN.md`) share protocol shape — keep them separate products:

| Idea | Lab closed-loop (now) | High mid-thought SPAWN |
|------|------------------------|------------------------|
| Structured handoff | orch tasks → exec DONE digests | parent `SPAWN` → child digests |
| Digests into parent | review/next round consumes `findings_digest` | merge digests into parent second pass |
| Cancel | Ctrl+C / cancel event mid-round | per-worker + run cancel (Heavy store) |
| No nested harness | never re-invoke `spockify lab` | no recursive agent loops / don’t turn Heavy into coding swarm |
| Back-to-back | plan→exec→review in one prompt | Phase A two-pass; Phase B segmented think |

Do **not** merge lab-agents into chat thinking; lab is the twin coding harness.

Install editable (optional):

```bash
pip install -e packages/spockify-lab-agents
```

Remap backends on the twin:

```bash
./scripts/lab-set-dual-roles.sh ORCH=deepseek-r1:70b EXEC=qwen2.5-coder:32b
./scripts/lab-ensure-twin.sh   # OFFLINE_MODE, MIN_USERS=1, NodePort, scale XTTS/ComfyUI
```

## IDE

1. Set `spockify.baseUrl` to the twin Open WebUI (`http://<twin-host>:30080`).
2. Sign in with a **LiteLLM API key** when possible (session JWT may fail on `:30400`).
3. Command Palette → **Spockify: Lab Agents (orch → exec)** — prompts for the task, reads `spockify.lab.*` settings, spawns this harness, streams to **Output → Spockify Lab Agents**.
4. Coding picker still keeps `lab-*` aliases (`lab-orchestrator`, `lab-executor`, …) for Plan/Agent chat.

Do not promote abliterated remaps as product defaults — twin-only via `lab-set-dual-roles.sh`.
