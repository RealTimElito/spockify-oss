# Spockify Chat panel (WS-CLONE-A)

Cursor-like **sidebar chat** for Spockify Desktop IDE — subset of [spockify.eu](https://spockify.eu) web chat.

## Owned paths

```text
extensions/spockify/src/chat/**          # host: provider, protocol, persistence, apply bridge
extensions/spockify/media/chat/**        # webview CSS/JS
extensions/spockify/src/commands/chat.ts # Ctrl+L focus command
```

## Commands

| Command | Purpose |
|---------|---------|
| `spockify.chat` / Ctrl+L | Focus chat view |
| `spockify.chat.new` | New chat (clears thread + new session id) |
| `spockify.chat.stop` | Abort in-flight generation |
| `spockify.chat.retry` | Retry last user turn |
| `spockify.chat.history` | Quick-pick prior sessions (workspace/global state) |
| `spockify.chat.openFull` | Open https://spockify.eu |

## Manual acceptance (WS-CLONE-A)

- [ ] **Focus** — Ctrl+L (or palette *Spockify: Chat*) focuses `spockify.chatView`.
- [ ] **Stream** — Send with an OSS model; assistant streams; TTFT shows in footer then total ms on finish.
- [ ] **Stop** — Stop button or `spockify.chat.stop` aborts stream; partial reply kept; status shows *Stopped*.
- [ ] **New** — `＋` or `spockify.chat.new` clears UI and starts a fresh session id.
- [ ] **Submit** — Enter and Ctrl/Cmd+Enter send; Shift+Enter inserts newline.
- [ ] **Sticky scroll** — Auto-scroll while pinned to bottom; scroll up to read history without being yanked down until you scroll back near bottom.
- [ ] **History** — After reload (or new window), last thread restores from workspace state; `⏱` / `spockify.chat.history` opens older sessions.
- [ ] **Retry** — Retry re-runs the last user message without duplicating the user bubble.
- [x] **Context chips** — `@file` / `@selection` / `@codebase` (BM25 via codebase provider; wired on Send)

- [ ] **Apply** — Code block Apply uses `../apply/ApplyService` when present, else composer diff preview (TODO WS-CLONE-K).
- [x] **SSH** — Panel works in Remote SSH window (inference still via spockify.eu transport).

## Integration

Call `registerChatPanel(context, { transport, output, … })` from extension `activate()`. Do not `fetch('https://spockify.eu')` from the webview — inject `ChatModelTransport` only.
