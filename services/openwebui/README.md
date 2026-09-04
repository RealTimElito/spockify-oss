# Spockify OpenWebUI fork

Custom Docker image based on [open-webui](https://github.com/open-webui/open-webui) **v0.9.6** with Spockify UX changes baked into the vendored source tree (no runtime sed or patch scripts).

**Self-host on any Linux distro (Ubuntu / Fedora):** [docker/README.md](../../docker/README.md) — `docker compose up --build`, or pull GHCR images / download `spockify-docker.zip`.

## Layout

```
services/openwebui/
├── Dockerfile              # Multi-stage build (Node frontend + Python backend)
├── upstream/               # Vendored open-webui @ v0.9.6 + Spockify edits in-tree
└── branding/               # Ephemeral — copied from k8s/openwebui/assets at build
```

Runtime init scripts (migrate-db, install guard) remain in `k8s/openwebui/scripts/` and mount via ConfigMap.

## Source

`upstream/` is a normal tracked directory in agentHub — not a git submodule. It contains open-webui v0.9.6 plus Spockify-specific edits:

| File | Change |
|------|--------|
| `backend/open_webui/env.py` | `WEBUI_NAME=Spockify` without `(Open WebUI)` suffix; LTX T2V/I2V env |
| `backend/open_webui/utils/middleware.py` | Disable parallel web search for `spockify-auto`; router status events; persist worker metadata; emit/persist router search `sources` (and url_citation annotations); video T2V/I2V; Canvas system tip |
| `src/lib/components/chat/Artifacts.svelte` | Spockify **Canvas** side panel (docs/code + HTML/SVG Artifacts) |
| `src/lib/utils/spockifyCanvas.ts` | Canvas fence detection helpers |
| `backend/open_webui/utils/videos/comfyui_video.py` | ComfyUI LTX text-to-video + image-to-video |
| `backend/open_webui/utils/video_options.py` | Per-turn LTX length chips (25/65/241 frames @ 24fps) |
| `src/lib/utils/videoOptions.ts` | Composer Length chips (Video toggle or video-intent prompt) |
| `src/lib/components/chat/MessageInput/IntegrationsMenu.svelte` | Integrations **Video** toggle (LTX), mutual exclusion with Image |
| `src/app.html` | Favicon without `crossorigin`; Spockify static asset links |
| `src/lib/utils/detectSpeechLanguage.ts` | TTS language detection; browser voice pick; edge-tts voice map for server fallback |
| `src/lib/components/chat/Messages/ResponseMessage.svelte` | Arena bubbles show `spockify-auto` name; muted worker label; hybrid TTS (browser or edge-tts) |
| `src/lib/components/chat/Chat.svelte` | Store `spockifyWorker` / `spockifyWebSearch` from router SSE on assistant messages |
| `src/lib/components/chat/MessageInput/CallOverlay.svelte` | Call-mode hybrid TTS (browser or edge-tts) |
| `backend/open_webui/routers/audio.py` | `edge` TTS engine (Microsoft Edge neural voices via edge-tts; no API key) |
| `static/static/spockify-*.{css,js}` | Model picker in input row, drop-up dropdown; hide suggestion chips |

Branding PNGs/ICO are copied from `k8s/openwebui/assets/` during `make build-openwebui`.

## Build approach

1. **Source:** vendored `upstream/` with Spockify edits already applied
2. **Frontend:** `npm ci && npm run build` inside Docker
3. **Branding:** PNG/ICO from `k8s/openwebui/assets/` via ephemeral `branding/` at build time

## Dev workflow

```bash
make build-openwebui            # build + push to MicroK8s registry
make deploy                     # builds image if registry is up, then applies k8s
make logs-openwebui
```

Local iteration without full deploy:

```bash
./scripts/build-openwebui.sh
microk8s kubectl rollout restart deployment/openwebui -n spockify
```

## Upgrading OpenWebUI

Full stock-vs-new file list: [docs/SPOCKIFY_OPENWEBUI_TOUCHLIST.md](../../docs/SPOCKIFY_OPENWEBUI_TOUCHLIST.md). Prefer adding to Spockify modules over editing more stock files.

1. Replace `upstream/` with a fresh checkout of the new upstream tag (or merge upstream changes file-by-file).
2. Re-apply Spockify edits (table above + touch-list).
3. Re-test UX: favicon, model toolbar, no suggestions, spockify-auto label, web search off for auto.
4. `make build-openwebui && make deploy`

Postgres schema migrations still run via the `migrate-db` init container (`migrate-openwebui-db.py`).

## Image

- **Registry:** `localhost:32000/spockify-openwebui:latest`
- **Base:** open-webui v0.9.6 (CPU slim, same deps as upstream default image)

## Speech-to-text (dictation / microphone)

Server STT uses **local faster-whisper** (`AUDIO_STT_ENGINE` unset). On the host/the edge host the model is **`large-v3`** (int8, CPU) with **auto language detection** (`WHISPER_LANGUAGE` unset, `WHISPER_MULTILINGUAL=true`). Weights live on the OpenWebUI PVC under `cache/whisper/models`.

| Setting | Value | Notes |
|---------|-------|-------|
| Engine | local Whisper | Admin → Audio → STT engine empty / Default |
| Model | `large-v3` | Multilingual; better than `base` |
| Language | auto | Leave user Settings → Audio → Language blank |
| Fallback | Web API | User can pick “Web API” (browser); set Language if needed |

**Enable in the UI:** open a chat → mic button on the input → allow microphone → speak → stop/confirm. Text is transcribed server-side and inserted into the input.

**Verify (Swedish + English):** dictate a Swedish sentence, then an English one, without changing Language — both should transcribe in the spoken language (not force English).

No OpenAI/Deepgram/Azure STT key is required for the default path. Optional cloud STT would need `AUDIO_STT_ENGINE=openai` (or deepgram/azure) plus the matching API key.

## Text-to-speech (read aloud)

**Server edge-tts** (`AUDIO_TTS_ENGINE=edge` or empty — both paths use Microsoft Neural):

1. Detect language from the message text.
2. Resolve voice from Settings / Call pickers (`audio.tts.edgeVoiceByLang`), else auto defaults.
3. Call `/api/v1/audio/speech` and play the MP3 (Call mode + Read aloud always use the server — no browser SpeechSynthesis).

| Language | Auto server voice |
|----------|-------------------|
| Swedish (`sv`) | `sv-SE-SofieNeural` |
| English (`en`) | `en-US-AvaMultilingualNeural` |
| German / French / Spanish / Norwegian / Danish | matching `*-Neural` (Multilingual where listed) |

**Voice picker:** Settings → Audio → **Neural voices (edge-tts)** (per language), or Call mode SV/EN dropdowns. Includes Sofie / Mattias (Swedish) and Ava / Emma / Andrew / Brian Multilingual plus classic Jenny / Guy / Sonia (English). Preference: `audio.tts.edgeVoiceByLang` + `localStorage.spockifyEdgeVoiceByLang`.

Prosody: `AUDIO_TTS_EDGE_RATE` (default `+0%` in k8s; code fallback `-3%`), `AUDIO_TTS_EDGE_PITCH`, `AUDIO_TTS_EDGE_VOLUME`.

Call duplex latency (stream-first TTS, whisper warm, silence window): see [docs/SPOCKIFY_VOICE_LATENCY.md](../../docs/SPOCKIFY_VOICE_LATENCY.md).

| Check | Notes |
|-------|--------|
| Console | `[Spockify TTS] speaking lang=… via server edge-tts voice=sv-SE-SofieNeural` (or Ava Multilingual for EN) |
| Verify Swedish | Hard-refresh → Call / Read Aloud → Sofie neural |
| Verify English | Auto → `en-US-AvaMultilingualNeural` |
| Pick Mattias | Call SV → Mattias → `sv-SE-MattiasNeural` |
| Call mic | STT paused while thinking/streaming/TTS + cooldown |
| Stop speaking (Q1) | Clears edge-tts `<audio>` queue and resumes listen |
| Push-to-talk (Q1) | **Always listen** / **Hold to talk** |

OpenAI/Azure/ElevenLabs engines need API keys if configured. Browser Kokoro remains an optional user setting (English-oriented; no Swedish).
