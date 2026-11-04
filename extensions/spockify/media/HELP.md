# Spockify — Help & Tips

Self-hosted coding stack for open-weight models. Chat, Tab, Ctrl+K, Composer, and Agents in the IDE — pointed at **your** server.

There is no hosted Spockify.eu account picker. Connect local compose or any OpenAI-compatible `/v1` API.

**Open this page anytime:** Command Palette → **Spockify: Help & Tips** (`spockify.help`).

Source: [github.com/Spockify/spockify-oss](https://github.com/Spockify/spockify-oss)

---

## Setup (first run)

### 1. Run Spockify locally

```bash
git clone https://github.com/Spockify/spockify-oss.git
cd spockify-oss
cp .env.example .env
make up
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080), create the first admin account, then create an API key under **Settings → Account → API key**.

### 2. Connect the extension

1. Status bar **Spockify** chip, or Command Palette → **Spockify: Sign In**.
2. **Settings → Account** — choose one:

| Mode | What you enter |
|------|----------------|
| **Self-hosted Spockify** | Base URL `http://127.0.0.1:3080` + email + password |
| **API key** | Base URL + `sk-…` from that chat Account page (or another OpenAI-compatible server) |

Do **not** put `/v1` in the base URL. Do **not** use router `:4100` if you want Tab completions — Tab needs Open WebUI on `:3080`.

### 3. Use it

- **Chat** — Ctrl+L (or Chat side bar)
- **Ctrl+K** — in-place edit
- **Tab** — inline completions (when your stack has a FIM worker)
- **Composer** — multi-file edits
- **Agents** — multi-step coding window

---

## Other APIs / remote boxes

| Target | How |
|--------|-----|
| Another machine’s Spockify | Base URL `http://<host>:3080` (or your reverse-proxy product root) + email/password or `sk-` |
| LiteLLM / OpenAI-compatible proxy | **API key** mode — product root (no `/v1`) + virtual key. Chat works; Tab/FIM and Spockify tools need a full Spockify Open WebUI stack |

---

## Chat modes & @chips

| Mode | Behavior |
|------|----------|
| **Agent** | Full tools — edit, terminal, search |
| **Plan** | Plan first, then act |
| **Debug** | Investigate, then fix |
| **Multitask** | Parallel subtasks |
| **Ask** | Read-only |

| Chip | Attaches |
|------|----------|
| `@file` | Active editor file |
| `@selection` | Current selection |
| `@terminal` | Recent terminal output |
| `@codebase` | Local index hits |
| `@web` | SearXNG results from **your** server (when available) |

---

## Indexing (`@codebase`)

Local BM25 (+ optional hybrid embeddings). Chunk text stays on disk. Optional remote sync (if enabled) sends **metadata only**.

Command Palette → **Spockify: Reindex Codebase** after opening a folder.

---

## Useful settings

| Setting | Default | Notes |
|---------|---------|--------|
| `spockify.baseUrl` | `http://127.0.0.1:3080` | Product root, not `/v1` |
| `spockify.defaultModel` | `spockify-auto` | Must exist on your server |
| `spockify.chat.thinking` | High | Off → Low → Medium → High → Heavy |

Full curated page: **Spockify: Open Settings**.

---

## Privacy

API keys stay in VS Code Secret Storage. Requests go only to the base URL you set.

---

## Docs

- [spockify-oss Get Started](https://github.com/Spockify/spockify-oss#get-started)
- Releases: [spockify-oss/releases](https://github.com/Spockify/spockify-oss/releases)
