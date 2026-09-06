# Keybindings / chrome — Phase 2 shortcut conflict audit

## Shortcuts (Spockify)

| Shortcut | Command | When |
|----------|---------|------|
| Ctrl/Cmd+L | `spockify.chat` | `!terminalFocus` |
| Ctrl/Cmd+K | `spockify.inlineEdit` | `editorTextFocus && !inlineEditIsVisible && !suggestWidgetVisible` |
| Ctrl/Cmd+Enter | Accept inline preview | `spockify.inlineEditPreviewActive` |
| Ctrl/Cmd+Shift+Enter | Accept all Composer pending | `spockify.composer.hasPending` |
| Escape | Reject inline preview | `spockify.inlineEditPreviewActive` |
| Ctrl/Cmd+I | `spockify.composer` | `!terminalFocus` |
| Ctrl/Cmd+Shift+' | `spockify.terminalAgent` | `!terminalFocus` |
| Ctrl/Cmd+Shift+K | `spockify.apply` | `editorTextFocus && editorHasSelection` |
| Ctrl/Cmd+Alt+Z | `spockify.applyUndo` | `spockify.apply.canUndo` |
| Ctrl/Cmd+Shift+Backspace | `spockify.chat.stop` | `!terminalFocus` |

## Known VS Code conflicts

| Shortcut | Stock VS Code | Spockify mitigation |
|----------|---------------|---------------------|
| **Ctrl+K** | Chord prefix (`ctrl+k ctrl+s` keybindings, fold, etc.) | When-clause requires editor focus and excludes suggest/inline UI; when `spockify.inlineEditPreviewActive`, Accept/Reject win. Remaining chord races: users can rebind stock chords or Spockify inline edit. |
| **Ctrl+L** | “Select Line” in some keymaps / browsers | Bound only when `!terminalFocus`; Spockify Chat takes priority in default Spockify IDE product overlay. |
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
