# Spockify

Self-hosted coding stack for open-weight models. One kernel. Your GPUs.

Chat, Tab completions, Ctrl+K, Composer, and Agents in VS Code / VSCodium / Spockify IDE — pointed at **your** server. There is no hosted Spockify.eu account picker in this extension.

Source: [github.com/Spockify/spockify-oss](https://github.com/Spockify/spockify-oss)

## Setup (5 minutes)

### 1. Run Spockify locally

```bash
git clone https://github.com/Spockify/spockify-oss.git
cd spockify-oss
cp .env.example .env
make up
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080), create the first account (admin), then create an API key under **Settings → Account → API key**.

### 2. Connect the extension

1. Install this extension.
2. Open **Spockify Settings → Account** (status bar chip, or Command Palette → **Spockify: Sign In**).
3. Choose one:

| Mode | What you enter |
|------|----------------|
| **Self-hosted Spockify** | Base URL `http://127.0.0.1:3080` + email + password |
| **API key** | Base URL + `sk-…` key from that chat Account page |

Do **not** put `/v1` in the base URL. The extension appends it. Do **not** use the router port `:4100` if you want Tab completions — those need Open WebUI on `:3080`.

### 3. Chat

Command Palette → **Spockify: Chat**, or open the Chat side bar. Pick a model that exists on your stack (default `spockify-auto` if your compose exposes it).

## Other APIs / remote boxes

This client speaks OpenAI-compatible HTTP (`/v1/chat/completions`, `/v1/models`) with a Bearer key.

- **Another machine’s Spockify** — set Base URL to `http://<host>:3080` (or your reverse-proxy product root) and sign in with email/password or an `sk-` key.
- **LiteLLM / OpenAI-compatible proxy** — **API key** mode with that server’s root (no `/v1` suffix) and its virtual key. Chat works; Tab/FIM and Spockify-only tools need a full Spockify Open WebUI stack.

## What you get

- **Chat** — streaming, thinking levels, `@file` / `@codebase` / `@web`
- **Tab** — FIM completions when your Open WebUI exposes a completion worker
- **Ctrl+K** — in-place edits
- **Composer / Agents** — multi-step coding on the same harness as the Spockify CLI
- **Themes** — Spockify Dark / Light

## Useful settings

| Setting | Default | Notes |
|---------|---------|--------|
| `spockify.baseUrl` | `http://127.0.0.1:3080` | Product root, not `/v1` |
| `spockify.defaultModel` | `spockify-auto` | Must exist on your server |
| `spockify.chat.thinking` | High | Off → Low → Medium → High → Heavy |

## Docs & downloads

- Get Started (chat, IDE AppImage/deb, CLI): [spockify-oss README](https://github.com/Spockify/spockify-oss#get-started)
- Desktop IDE builds: follow the OSS README / release assets on that repo

## Privacy

API keys stay in VS Code Secret Storage. Requests go only to the base URL you set.

## License

MIT — [spockify-oss](https://github.com/Spockify/spockify-oss).
