# Agent runtime (Phase 1)

Unified tool loop for Chat, Composer, Terminal Agent, and remote tools.

See [docs/SPOCKIFY_IDE_PHASE1_RUNTIME_PLAN.md](../../../docs/SPOCKIFY_IDE_PHASE1_RUNTIME_PLAN.md).

- `SessionManager` — per-tab `chatTabId` index for chat cancel/pause/resume
- `ChatTabAgentHost` — concurrent chat tab agent turns + per-tab `DisplayStreamFilter`
- `AgentRuntime` — stream completions → parse ` ```tool ` fences → execute → continue
- Modes: `ask` / `agent` / `strict` (`spockify.agent.mode`)
- **Permissions** (`spockify.agentPermissionMode`): `allowAll` | `askEveryTime` | `autoRunReviewFiles`. Ask agent mode stays read-only. Legacy `runAllUnsandboxed` maps to `allowAll`.
- Chat composer UI modes (Cursor-like) → runtime:
  - **Agent** → `agent`
  - **Ask** → `ask`
  - **Plan** → `agent` + plan-first system hint (+ enables `terminalAgent.planApproval`)
  - **Debug** → `agent` + debug system hint
  - **Multitask** → `agent` + parallel-subtask hint (Agents spawn)
- Commands: `spockify.agent.listTools`, `spockify.agent.cancel`, `spockify.agent.setMode`
