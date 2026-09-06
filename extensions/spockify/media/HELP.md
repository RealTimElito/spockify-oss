# Spockify IDE — Help & Tips

Open-source Cursor-class desktop IDE. Completions and chat are **open models routed via Spockify** ([spockify.eu](https://spockify.eu)); your files and terminal stay on this machine (or a Remote SSH host).

**Open this page anytime:** Command Palette → **Spockify: Help & Tips** (`spockify.help`).

---

## Why Spockify (vs Cursor)

| Differentiator | What you get |
|----------------|--------------|
| **Open-model provenance** | Every assistant turn shows which model ran, plus **routed via spockify** — history keeps it. |
| **Self-hosted path** | Sign in to your Spockify account / open models — not a closed vendor cloud as the only option. |
| **Routing HUD** | Status bar + chat footer: last-turn latency (and cost when the API provides it). |
| **Web bridges** | Jump to vault, scheduled agents, and family/guest settings on spockify.eu without rebuilding the web app in the IDE. |
| **REH you control** | Remote SSH downloads **Spockify’s** remote server from spockify.eu — same product, published REH. |

Exact provenance chip text: `{model} · routed via spockify` (e.g. `Auto · qwen2.5-coder · routed via spockify`).

---

## Getting started

1. **Sign in** — Command Palette → **Spockify: Sign In**, or use **Sign in** in the Chat panel. Same account as [spockify.eu](https://spockify.eu).
2. **Open Settings** — Command Palette → **Spockify: Open Settings**, Chat header **⚙**, status-bar gear, or account menu. Curated page for account, usage, models, rules, indexing, agent, and updates (stock `spockify.*` settings remain available).
3. **Open a folder** — File → Open Folder (needed for indexing and `@codebase`).
4. **Chat** — **Ctrl+L** (or secondary side bar **Chat**).
5. **Extensions** — Spockify uses **[Open VSX](https://open-vsx.org/)**, not the Microsoft Marketplace. Extensions → search (e.g. `ms-python.python` for the Python interpreter status bar).

Optional: **Spockify: Set API Key** for a LiteLLM / OpenAI-compatible key instead of session sign-in.

---

## Chat, Agent, modes, @chips

### Modes (composer pill)

| Mode | Behavior |
|------|----------|
| **Agent** | Full tools — edit, terminal, search |
| **Plan** | Plan first, then act with tools |
| **Debug** | Investigate systematically, then fix |
| **Multitask** | Parallel subtasks; use **Agents** when useful |
| **Ask** | Read-only — no mutating tools |

Status-bar **agent mode** (`ask` / `agent` / `strict`) is the runtime tool policy; the chat pill maps Plan/Debug/Multitask → agent tools with extra system hints.

### @ context chips

In Chat (and Composer), toggle chips or type mentions:

| Chip / mention | What it attaches |
|----------------|------------------|
| `@file` | Active editor file |
| `@selection` | Current selection |
| `@terminal` | Recent integrated-terminal output |
| `@codebase` | Hits from the **local** codebase index |

Tips:

- From the **terminal**, **Ctrl+L** focuses Chat and attaches `@terminal`.
- Type `@` / use **Attach** to insert mentions; `@folder` also works for scoped retrieval.
- **Auto** model + optional **Max** mode live next to the model picker.
- **Agents** button (or ⚡) spawns parallel agent runs from the draft / last prompt.
- Streaming tool use shows as **tool cards** (expand for details; terminal cards show **Will run:** / **Ran:**).
- Each assistant reply has a provenance chip: model id **· routed via spockify**.

### Composer (**Ctrl+I**)

Multi-file edits with pending Accept / Diff / Discard. Default review mode opens the Diff Review panel. Accept all: **Ctrl+Shift+Enter** when pending. Assistant output shows the same provenance chip.

---

## Indexing (`@codebase`)

The index is **local** (BM25 + optional hybrid embeddings). Chunk text/vectors stay on disk; optional cloud sync sends **metadata only** (fingerprint, counts, embed model).

### How to index

1. Open a **workspace folder**.
2. Index builds automatically on startup (setting `spockify.codebase.indexOnStartup`, default **on**).
3. Or run **Spockify: Reindex Codebase** (`spockify.codebase.reindex`).
4. Watch the **status bar** database chip: chunk/file counts when ready; spinner while indexing. Click → **Codebase Index Status**.
5. Progress also logs to the **Spockify Codebase** output channel.

### Configure depth

**Spockify: Configure Codebase Index Depth** (`spockify.codebase.configure`):

| Preset | Chunks |
|--------|--------|
| Balanced (default) | 60-line chunks · 8 overlap |
| Deep | 40-line · 12 overlap · more hits |
| Fast | 100-line · 6 overlap |

Then choose **Reindex** when prompted.

Useful settings (`spockify.codebase.*`): **`autoAttach`** (default on — injects search hits into Chat/Composer without clicking `@codebase`), `autoAttachAsk`, `reindexOnSave`, `chunkMaxLines`, `hybrid`, `embedModel` (default `nomic-embed`), `remoteIndexMeta`, `maxFileBytes`. Ignore via `.gitignore` / `.spockifyignore`.

Chat status shows `@codebase · N hit(s)` when auto-attach (or the chip) finds snippets. Agents can also call `codebase_search` for deeper lookups; thin/empty index results **auto-escalate** with a `grepFallback` and prompts push multiple **`grep`** / **`glob_file_search`** / **`read_file`** passes — never claim the repo cannot be browsed.

### Web Search (@web)

Enable the **@web** context chip (or type `@web` / `@docs`) to prefetch SearXNG results — same backend as [spockify.eu](https://spockify.eu) chat. Agents can also call **`web_search`** and **`fetch_url`** (OWUI → router browser fetch) mid-turn for more results or page text. Requires sign-in.

### Remote SSH notes

- Spockify AI is **`ui`-kind** — Chat/indexing run on your **laptop**, reading the remote FS over the SSH bridge.
- **File tools** (`write_file` / `apply_patch` / `read_file`) use `vscode.workspace.fs` (remote-safe). Prefer those over shell redirects for creating/editing files.
- **`terminal_run`** executes on the **remote** host via the integrated terminal / shellIntegration (never local `spawn /bin/bash` on the UI client — that caused ENOENT on some laptops).
- **@codebase** indexes via `workspace.fs` (Remote SSH–safe). By default Chat/Composer **auto-attach** retrieval hits to each turn (`spockify.codebase.autoAttach`). Status shows `@codebase · N hit(s)`. Reindex after connecting if the remote tree is large or newly opened.
- Index files live under the extension’s global storage (`codebase/<hash>.json`), not inside the REH tarball.

If `@codebase` returns nothing: run **Reindex Codebase**, confirm a folder is open, check status-bar / output for errors.

---

## Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+L** | Chat (editor: `@file`/`@selection`; terminal: `@terminal`) |
| **Ctrl+K** | Inline edit (editor) · **Quick Question** overlay (terminal) |
| **Ctrl+I** | Composer |
| **Ctrl+Shift+K** | Apply / edit selection |
| **Ctrl+Enter** / **Esc** | Accept / reject inline preview |
| **Ctrl+Shift+Enter** | Accept all Composer pending |
| **Ctrl+Shift+Backspace** | Stop Chat or Composer generation |
| **Ctrl+Alt+Z** | Undo last Apply |
| **Ctrl+Shift+'** | Terminal Agent |
| SCM commit | **Spockify: Generate Commit Message** |

Also: **Spockify: Shortcut / Keybinding Audit** opens the keybinding notes.

---

## Terminal Quick Question & tool cards

- Focus the integrated terminal → **Ctrl+K** → floating **Quick Question** card. Describe the command; Spockify proposes shell, then you accept to send it to the PTY.
- Raw shell-looking replies are normalized and can run via `sendText`.
- In Chat/Composer, `terminal_run` and other tools appear as compact **tool cards** inline in the transcript (in time order with the assistant text), not dumped at the bottom. Expand for stdout/stderr. Apply cards expose Undo / Checkpoints.
- Assistant file paths / `` `path:line` `` citations are **clickable** — they open the file in the editor (Remote SSH URIs included).

Terminal Agent (**Ctrl+Shift+'**) plans multi-step shell work with ask-default policy; sessions tree supports Continue / Rewind / audit log.

---

## Remote SSH + REH

1. **Spockify: Connect to Host (SSH config)** (or Remote Explorer).
2. First connect downloads the **Spockify remote server (REH)** from `spockify.eu` into `~/.spockify-ide-server/bin/<commit>/` on the host — **hosted and published by Spockify**, not a third-party binary.
3. Files, terminal, debug, LSP run **on the remote**; Chat / Composer / models stay on the **local UI** and are **routed via Spockify**.

Requirements: OpenSSH with TCP forwarding; outbound HTTPS to spockify.eu for the REH tarball. About → commit must match a published REH.

Python interpreter status bar comes from Open VSX **`ms-python.python`** (install on remote for remote interpreters).

---

## Web Spockify (deep links)

Open these in the browser from the Command Palette (same account):

| Command | Opens |
|---------|--------|
| **Spockify: Open Vault (Web)** | spockify.eu chat / vault |
| **Spockify: Open Scheduled Agents (Web)** | `/spockify/agents` |
| **Spockify: Open Family / Guest Settings (Web)** | `/admin/settings/spockify-family` |
| **Spockify: Open IDE Site** | `/ide` |

---

## Updates from spockify.eu

- In-IDE: **Spockify: Check for Updates** — polls `https://spockify.eu/api/v1/spockify/ide/appimage/latest.json`. Primary **Download** opens [spockify.eu/ide/releases.html](https://spockify.eu/ide/releases.html); **Direct download** fetches the AppImage.
- **AppImage:** download, `chmod +x`, replace your previous binary.
- **.deb (Debian/Ubuntu):** `sudo dpkg -i Spockify-IDE_*.deb` (then `sudo apt-get install -f` if deps are missing).
- Marketing / release notes: [spockify.eu/ide](https://spockify.eu/ide).

---

## Quick command index

| Command | Purpose |
|---------|---------|
| `spockify.help` | This page |
| `spockify.signIn` | Sign in |
| `spockify.chat` | Open Chat |
| `spockify.codebase.reindex` | Rebuild index |
| `spockify.codebase.configure` | Index depth presets |
| `spockify.codebase.status` | Index status |
| `spockify.composer` | Composer |
| `spockify.inlineEdit` / `.terminal` | Ctrl+K |
| `spockify.git.generateCommitMessage` | SCM commit message |
| `spockify.update.check` | Check AppImage updates |
| `spockify.remoteSsh.connect` | Remote SSH |
| `spockify.web.openVault` | Web vault |
| `spockify.web.openScheduledAgents` | Web scheduled agents |
| `spockify.web.openFamilySettings` | Family / guest caps |

More: [spockify.eu](https://spockify.eu) · [spockify.eu/ide](https://spockify.eu/ide).
