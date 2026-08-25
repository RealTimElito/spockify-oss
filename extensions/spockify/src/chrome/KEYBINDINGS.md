# Keybindings / chrome — Phase 2 shortcut conflict audit

## Shortcuts (Spockify)

| Shortcut | Command | When |
|----------|---------|------|
| Ctrl/Cmd+L | `spockify.chat` | Anywhere except terminal clear — editor/global focuses Chat with @file/@selection; **terminalFocus** unbinds `workbench.action.terminal.clear` and attaches @terminal |
| Ctrl/Cmd+Shift+N | `spockify.chat.new` | `view == spockify.chatView && !terminalFocus` — new tab (saves draft on prior tab) |
| Ctrl/Cmd+Alt+← / → | `spockify.chat.previousTab` / `.nextTab` | Chat view focused — cycle open tabs (not Ctrl+Tab; avoids editor group conflict) |
| Ctrl/Cmd+K | `spockify.inlineEdit` | Editor: inline code edit |
| Ctrl/Cmd+K | `spockify.inlineEdit.terminal` | `terminalFocus` — floating overlay in terminal pane (Cursor-like) |
| Ctrl/Cmd+Enter | Accept inline preview | `spockify.inlineEditPreviewActive` |
| Ctrl/Cmd+Shift+Enter | Accept all Composer pending | `spockify.composer.hasPending` |
| Escape | Reject inline preview | `spockify.inlineEditPreviewActive` |
| Ctrl/Cmd+I | `spockify.composer` | `!terminalFocus` |
| Ctrl/Cmd+Shift+' | `spockify.terminalAgent` | `!terminalFocus` |
| Ctrl/Cmd+Shift+K | `spockify.apply` | `editorTextFocus && editorHasSelection` |
| Ctrl/Cmd+Alt+Z | `spockify.applyUndo` | `spockify.apply.canUndo` |
| Ctrl/Cmd+Shift+Backspace | `spockify.chat.stop` | `!terminalFocus` — aborts Chat **or** Composer when generating |

## Known VS Code conflicts

| Shortcut | Stock VS Code | Spockify mitigation |
|----------|---------------|---------------------|
| **Ctrl+K** | Chord prefix (`ctrl+k ctrl+s` …); Mac terminal **Clear** is Cmd+K | `terminal.integrated.allowChords=false` + `commandsToSkipShell` includes `spockify.inlineEdit.terminal`; unbind `workbench.action.terminal.clear` on Ctrl/Cmd+K in terminal. |
| **Ctrl+L** | Shell/readline clear-screen when key reaches PTY | `commandsToSkipShell` includes `spockify.chat` (product overlay + extension defaults); unbind stock clear on Ctrl/Cmd+L. |
| **Ctrl+I** | Insert / suggest in some modes | Bound when `!terminalFocus`; Composer is the intentional product binding. |
| **Ctrl+Shift+'** | Uncommon stock binding | Terminal agent entry; document if user keymaps collide. |
| **Ctrl+Enter** | Accept suggest / notebook | Gated by `spockify.inlineEditPreviewActive` only. |
| **Escape** | Close widgets | Same preview context gate. |

## Chrome surfaces

- Status bar: Spockify account · agent mode · codebase index chunks · sync on/off · active session stop · Tab latency (after ghost hit)
- Secondary sidebar **Spockify**: Chat · Composer · Agents · Terminal sessions
- Diff review: `spockify.diffReview` — **WebviewPanel** multi-file Accept all / per-file / Discard / colored diffs (ApplyService); post-accept toast with **Undo** / **Checkpoints**
- Apply / checkpoints: `spockify.applyUndo` (Ctrl+Alt+Z) · `spockify.checkpoints.list` / `.restore` / `.create` · status bar undo chip · Chat apply_patch cards expose Undo / Restore / List
- Agent lifecycle: `spockify.agent.cancel` — Stop square in chat (replaces Send while running); Escape also stops. Pause removed.
- Composer pending: Accept / Diff / Discard inline on tree items; view title Accept all / Diff Review / Discard all when `spockify.composer.hasPending`
- Composer default `reviewMode=panel` (no modal after turn); `verifyAfterTurn` off by default
- Ctrl+K: **streaming** preview (cancellable) + non-blocking message + **Ctrl+Enter / Esc** (no modal QuickPick)
- Terminal agent: sessions tree Continue / Open / Rewind; `spockify.terminalAgent.rewind` (transcript + cwd restore); audit: `spockify.terminalAgent.auditLog`
- Agents: live cards + synthesis teasers; **Stop** / Stop all; history; Chat ⚡ spawns parallel agents from draft/last prompt
- Sync: `spockify.sync.now` / `spockify.sync.toggle` (default **on**; quiet sync after sign-in; 412 merge picker)
- Theme: **Spockify Dark** (product default `workbench.colorTheme`)
