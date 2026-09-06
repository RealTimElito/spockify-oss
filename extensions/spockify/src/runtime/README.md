# Agent runtime (Phase 1)

Unified tool loop for Chat, Composer, Terminal Agent, and remote tools.

See [docs/SPOCKIFY_IDE_PHASE1_RUNTIME_PLAN.md](../../../docs/SPOCKIFY_IDE_PHASE1_RUNTIME_PLAN.md).

- `SessionManager` — per-tab `chatTabId` index for chat cancel/pause/resume
- `ChatTabAgentHost` — concurrent chat tab agent turns + per-tab `DisplayStreamFilter`
- `AgentRuntime` — stream completions → parse ` ```tool ` fences → execute → continue
- Modes: `ask` / `agent` / `strict` (`spockify.agent.mode`)
- **Horizon** (`spockify.agent.maxTurns`, default **48**, max **80**): Agent / Composer / Chat Agent loop budget. Ask stays ~12.
- **Permissions** (`spockify.agentPermissionMode`, default **autoRunReviewFiles**): `allowAll` | `askEveryTime` | `autoRunReviewFiles`. Ask agent mode stays read-only. Plan still gates mutators until approved. Legacy `runAllUnsandboxed` maps to `allowAll`.
- Agent prompts include **test-until-green**: after edits, run tests/lint via `terminal_run` and do not claim done without a green run.
- Chat `terminal_run` default timeout **5m** (`spockify.terminalAgent.timeoutMs`).
- Composer `verifyAfterTurn` default **on** (Skip still first in the QuickPick).
- Chat composer UI modes (Cursor-like) → runtime:
  - **Agent** → `agent`
  - **Ask** → `ask`
  - **Plan** → `agent` + plan-first system hint (+ enables `terminalAgent.planApproval`)
  - **Debug** → `agent` + debug system hint
  - **Multitask** → `agent` + parallel-subtask hint (Agents spawn)
- Commands: `spockify.agent.listTools`, `spockify.agent.cancel`, `spockify.agent.setMode`

## YOLO long-horizon agent

Default Agent already auto-runs shell and stages file review (`autoRunReviewFiles`). For full YOLO (auto-apply patches + long horizon):

1. Set **`spockify.agentPermissionMode`** → **`allowAll`** (composer chip: Allow all), **or** CLI `spockify --yolo`
2. Optionally raise **`spockify.agent.maxTurns`** (default 48 → up to 80)
3. Optionally raise **`spockify.terminalAgent.timeoutMs`** for slow suites
4. Keep **Ask** / **Plan** when you want human gates; they stay read-only / plan-approve

## Phase 2 (eval harness — not product)

Optional later: point mini-SWE-agent / OpenHands at Spark LiteLLM for SWE-bench smoke. Do not fold Heavy ensemble into a coding harness; leave Tab/FIM alone.
