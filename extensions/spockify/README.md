# Spockify VS Code / code-oss extension (WS-B)

First-party AI extension for **Spockify Desktop IDE**. Talks to **`https://spockify.eu`** via `@spockify/ide-client` (`RemoteSpockifyProvider`). Local models are stubbed only.

## Layout

| Path | Role |
|------|------|
| `src/extension.ts` | Activation, health / models / API key commands |
| `src/auth.ts` | SecretStorage for API key |
| `src/chat/**` | **WS-C** Chat webview panel (streaming stub + OSS picker) |
| `media/chat/**` | Chat webview CSS/JS |
| `src/commands/chat.ts` | Focuses Chat panel |
| `src/commands/complete.ts` | Ghost complete stub → `/spockify/ghost/suggest` |
| `src/commands/apply.ts` | Ghost edit / apply stub |
| `src/providers.ts` | Provider enum metadata (remote + local coming soon) |
| `../../packages/spockify-ide-client` | Shared HTTP + `ModelTransport` |

**Contribution IDs:** secondary side bar container `spockify` (title Chat, icon `$(chat-sparkle)` → `workbench.view.extension.spockify`), chat `spockify.chatView`, agents `spockify.agents`. Same Auxiliary Bar slot as stock Copilot Chat.

## Settings

| Key | Default | Notes |
|-----|---------|--------|
| `spockify.baseUrl` | `https://spockify.eu` | Product root (not `/v1`) |
| `spockify.provider` | `remote` | `local` = coming soon |
| `spockify.defaultModel` | `spockify-auto` | Chat default |
| `spockify.models.ossOnly` | `true` | WS-E will enforce |

API key: command **Spockify: Set API Key** (SecretStorage). Optional env `SPOCKIFY_API_KEY` for Extension Development Host.

## Build

```bash
# Shared client first
cd /home/you/spockify/packages/spockify-ide-client
npm install
npm run build

cd /home/you/spockify/extensions/spockify
npm install
npm run compile
```

## Run against VS Code / Cursor (dev)

1. Open `extensions/spockify` as a folder (or add it to a multi-root workspace).
2. `npm run compile` (or Run → Start Debugging with **Run Spockify Extension**).
3. In the Extension Development Host: **Spockify: Set API Key**, then **Spockify: Check API Health**.

Command Palette: **Spockify: Chat** (opens side panel), **Complete (Ghost)**, **Apply Diff**.

Chat subset vs deferred: see [`src/chat/README.md`](./src/chat/README.md) (plan §7).

## Load later against Spockify code-oss (`apps/spockify-ide`)

When WS-A has a bootable tree, either:

**A. Extension Development Host (fastest for WS-B)**

```bash
# From the code-oss / Spockify IDE binary, or stock code / VSCodium:
./scripts/code.sh --extensionDevelopmentPath=/home/you/spockify/extensions/spockify
```

**B. Built-in / bundled extension (product path)**

1. Symlink or copy into the product extensions dir, e.g.  
   `apps/spockify-ide/.../extensions/spockify` → this folder (coordinate path with WS-A).
2. Or set `extensionsGallery` / built-in list in `product.json` so Spockify ships as a first-party extension.
3. Rebuild / relaunch the desktop app.

Activation uses `onStartupFinished` so it also runs in **Remote SSH** windows once WS-A SSH is available (extension host on remote or UI side as configured).

## Smoke without UI

```bash
cd /home/you/spockify/packages/spockify-ide-client
export SPOCKIFY_API_KEY=sk-...
npm run test:smoke
```

## Out of scope (M0)

- Chat panel polish beyond streaming stub / OSS picker (see WS-C README for deferred Lab/Calendar/etc.)
- InlineCompletionProvider / multi-file apply UI (WS-D)
- Local Ollama / LM Studio (later)
- Editing `apps/spockify-ide` workbench
- Full Open WebUI embed