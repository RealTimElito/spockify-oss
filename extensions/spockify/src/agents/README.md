# Spockify Agents panel (`src/agents/**`)

Multi-agent / room / parallel runs in the IDE Auxiliary Bar **Agents** view (`spockify.agents`). Backed by `@spockify/ide-client` → `/spockify/agents/runs` on spockify.eu.

## Commands (for Chat / other features)

| Command ID | Args | Purpose |
|------------|------|---------|
| `spockify.agents.focus` | — | Focus Agents tree |
| `spockify.agents.refresh` | — | Reload runs from API |
| `spockify.agents.newRun` | — | New parallel run (prompt input) |
| `spockify.agents.newRoom` | — | New room run (prompt input) |
| `spockify.agents.spawnFromPrompt` | `prompt?: string` | Start parallel run; optional prompt (else input box). **Chat should call this** instead of duplicating create logic. |
| `spockify.agents.cancel` | `TreeItem?` | **Stop** one live run (modal confirms; optimistic “stopping…”) |
| `spockify.agents.cancelAll` | — | Stop all live runs |
| `spockify.agents.openRun` | `runId: string` | Open full run + synthesis as markdown beside editor |
| `spockify.agents.copyRunId` | `TreeItem?` | Copy run id to clipboard |
| `spockify.agents.history` | — | Quick-pick past runs (shows synthesis teaser) |

Example from another extension or webview host:

```typescript
await vscode.commands.executeCommand(
  'spockify.agents.spawnFromPrompt',
  'Research options for X and summarize tradeoffs',
);
```

## Behaviour

- **Live cards:** Busy runs expand so worker rows stay visible. Descriptions show `done/total`, live count, and synthesis/error teasers. Markdown tooltips include prompt + synthesis snippet.
- **Live poll:** ~1.5s while workers active; ~2s when only synthesizing. Stops when idle. Title shows `N live` / `stopping N…`.
- **Cancel clarity:** Toolbar **Stop** (not “Cancel”) → modal **Stop run**; optimistic `stopping…` until acknowledged; **Stop all** for every live run.
- **Open run:** Markdown beside editor; cursor on **Synthesis** when text exists; note if still synthesizing.

## WS-CLONE-F acceptance checklist

Manual verification on Extension Host or AppImage with Spockify sign-in:

- [ ] **Parallel run:** Agents → New Parallel Agent Run → prompt → run appears; panel focuses.
- [ ] **Live status:** Worker rows + descriptions update without Refresh (~1.5s); busy runs stay expanded.
- [ ] **Synthesis teaser:** When synthesizing/done, description/tooltip shows synthesis snippet; open jumps to heading.
- [ ] **Stop one:** Inline Stop → confirm **Stop run** → `stopping…` then cancelled.
- [ ] **Stop all:** Title action stops every live run.
- [ ] **Idle poll stop:** When all runs finish, polling stops.
- [ ] **Auth errors:** Signed out or 401 → sign-in hint.
- [ ] **spawnFromPrompt API:** `executeCommand('spockify.agents.spawnFromPrompt', 'test')` starts a run.

## Chat tab agent runs (concurrent)

Per open chat tab (`PersistedChatSession.id` = **chatTabId**):

- `runtime/chatTabAgentHost.ts` — one `AgentRuntime` turn per tab; per-tab `DisplayStreamFilter`, cancel, pause/resume.
- `agents/chatTabController.ts` — re-exports for `ChatPanelProvider`.
- `SessionManager.create(mode, surface, chatTabId?)` — deterministic `cancelByChatTabId` / `pauseByChatTabId` without touching composer/terminal sessions.

Stream/tool host messages include `chatTabId`; the webview ignores events for other tabs.

- `agentRunLogic.ts` — pure labels / poll / markdown (unit-tested)
- `agentRunUi.ts` — ThemeIcon / MarkdownString / collapsible wrappers
