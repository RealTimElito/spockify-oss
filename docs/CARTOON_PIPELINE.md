# Cartoon pipeline (sprite grid → slice → FLF → VACE edit)

Self-hosted path for short cartoon beats. One Qwen-Image canvas keeps character
colors, line weight, and proportions consistent across frames; Wan FLF animates
between sliced keyframes; optional **Wan 2.1 VACE 1.3B** restyles the clip in
latent space with motion coherence.

LabRats LatentSync dialogue and MiniMax H3 atmos are **unchanged**. This lane
does not replace Open Jealousy Illustrious plates.

## Stages

| Stage | What | Model / tool |
|-------|------|----------------|
| 1. `sprite_grid` | Multi-panel contact sheet (2×2 or 3×3) on one canvas | `qwen-image-2.1` via `/v1/images` |
| 2. `slice` | Deterministic equal-tile crop, left→right then top→bottom | ffmpeg crop in the router |
| 3. `flf` | First/last or adjacent tiles → video | `wan2.1-flf2v` via `/v1/videos` (`input_reference` + `end_image`) |
| 4. `video_edit` | Motion-coherent V2V restyle | **`wan2.1-vace-1.3b`** via `/v1/cartoon/edit` (Wan — **not Qwen**) |

Cold contract: `GET /v1/cartoon/policy`.

## Try it (API)

Use an OpenAI-compatible user key (`sk-…` from chat Settings → Account).

```bash
export BASE=https://YOUR_HOST   # or http://127.0.0.1:4100 via port-forward
export KEY=sk-...

# Policy (no GPU)
curl -sS "$BASE/v1/cartoon/policy" -H "Authorization: Bearer $KEY" | jq .

# Full run: Qwen contact sheet → slice → Wan FLF job(s)
# run_edit=true chains Wan VACE after each FLF clip completes
curl -sS -X POST "$BASE/v1/cartoon" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a small fox hops onto a stump and waves",
    "grid": "2x2",
    "pair_mode": "first_last",
    "style": "clean 2D cartoon cel, flat colors",
    "seconds": 2,
    "video_size": "1280x720",
    "include_tiles": true,
    "run_edit": true
  }' | tee cartoon.json

# Poll the FLF job
VID=$(jq -r '.videos[0].id' cartoon.json)
curl -sS "$BASE/v1/videos/$VID" -H "Authorization: Bearer $KEY" | jq .
# when status=completed:
curl -sS "$BASE/v1/videos/$VID/content" -H "Authorization: Bearer $KEY" -o beat.mp4

# Restyle a completed clip (or any short mp4) with Wan VACE
curl -sS -X POST "$BASE/v1/cartoon/edit" \
  -H "Authorization: Bearer $KEY" \
  -F "prompt=watercolor ink wash cartoon, soft paper texture" \
  -F "seconds=2" \
  -F "size=832x480" \
  -F "video=@beat.mp4;type=video/mp4" | tee edit.json
EDIT=$(jq -r '.id' edit.json)
curl -sS "$BASE/v1/videos/$EDIT" -H "Authorization: Bearer $KEY" | jq .
# cancel if the GPU job is long:
curl -sS -X POST "$BASE/v1/videos/$EDIT/cancel" -H "Authorization: Bearer $KEY"
```

### Options

- `grid`: `2x2` (default) or `3x3`. Canvas defaults to `1536x1536`.
- `pair_mode`: `first_last` (one clip, tile 0 → last) or `adjacent` (tile i → i+1).
- `run_edit`: when true and VACE is installed, chains a Wan VACE restyle after each FLF clip completes (async).
- `POST /v1/cartoon/slice` — crop only (multipart `image` or JSON `b64_json`).
- `POST /v1/cartoon/edit` — Wan VACE V2V (multipart `video` / JSON `video_id` or `b64_json`).

## Image edit (`POST /v1/images/edits`)

Qwen-Image-Edit is this route. `POST /v1/images/generations` with
`model=Qwen-Image-Edit` (or `qwen-image-edit`) and no image returns **400**
and names this path. It does not silently run `qwen-image-2.1` text-to-image.
If that generations call includes a real image, it is routed here as an edit.

The sampler is Qwen-Image 2.1 with reference slots `images.image_1`, then
`images.image_2`. Sizes snap to a multiple of 16. The max edge is 2048.
Typical sizes: `1024x1024`, `1536x1536`, `2048x2048`, `2048x1152`.

| Field | Required | What |
|-------|----------|------|
| `prompt` | yes | What to change |
| `image` | one of image or `character_plate` | Source plate (file or data-URL) |
| `character_plate` | optional | Locked character plate, a real image |
| `background` | optional | Locked background, a real image (second reference) |
| `size` | no | Canvas, snapped as above |

JSON:

```bash
curl -sS -X POST "$BASE/v1/images/edits" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "same character, standing in this street, cel style",
    "character_plate": "data:image/png;base64,...",
    "background": "data:image/png;base64,...",
    "size": "1024x1024"
  }'
```

Multipart (the fields the server reads):

```bash
curl -sS -X POST "$BASE/v1/images/edits" \
  -H "Authorization: Bearer $KEY" \
  -F "prompt=same character in this city, cel style" \
  -F "character_plate=@frank-plate.png;type=image/png" \
  -F "background=@city_spawn.png;type=image/png" \
  -F "size=1024x1024"
```

`image` is the single-plate edit field when you are changing one picture
rather than binding a character and a background.

## Identity on the sprite grid

`POST /v1/cartoon` conditions the Qwen contact sheet only when
`character_plate` and/or `background` are attached (same field names, files
or data-URLs). Those bytes are the images the Qwen step sees. The response
then has `identity_lock=qwen-reference` and `identity_conditioned=true`.

Pack ids (`character_pack_id`, `style_pack_id`) do not contain pixels.
`packs.live_route` stays false. A prompt-only call, including one that only
sends pack ids, returns `identity_lock=edit-only` and
`identity_conditioned=false`. That is not a silent lock.

Working hobby path for locked plates: upload the character plate and the
city background on `POST /v1/cartoon` (or edit keyframes with
`POST /v1/images/edits`), then slice, then Wan FLF. Dialogue still uses
XTTS or `model=qwen3-tts` on `POST /v1/audio/speech`, then lipsync.

`commercial_export=true` stays **403**. The flag on a normal response stays
false. This is not a GA stamp.

### Manual two-step (without `/v1/cartoon`)

1. `POST /v1/images/generations` with model `qwen-image-2.1` and a contact-sheet prompt.
2. Slice locally or via `/v1/cartoon/slice`.
3. `POST /v1/videos` with `model=wan2.1-flf2v`, `input_reference`, and `end_image`/`last_frame`.
4. `POST /v1/videos` with `model=wan2.1-vace-1.3b` and `control_reference` (source mp4), or use `/v1/cartoon/edit`.

## Video edit honesty

| Candidate | ~Size | Status |
|-----------|-------|--------|
| **Wan 2.1 VACE 1.3B** | ~4.1 GiB (`wan2.1_vace_1.3B_fp16.safetensors`) | **Installed** — motion-coherent V2V. **Not Qwen.** |
| **Qwen-Video-Edit** | ~55 GiB | Still blocked on disk without wiping LabRats / Open Jealousy models. |

`GET /v1/cartoon/policy` → `pipeline[video_edit].ready=true` when VACE is on disk.
Cold catalog row `wan2.1-vace-1.3b` sets `video_edit_supported: true`.

## Chat UI

In Open WebUI, open the **+ / more** menu and enable **Cartoon**. That turns on the
sprite-grid → FLF path for the next send (same simple mobile layout; no new
main-bar chips). Prefer the API above when scripting restyles.

## Rights and frame contract

`GET /v1/cartoon/policy` adds `commercial_export: false`, a `rights` block, and
`frame_contract`. Those fields are additive. Existing clients can ignore them.

Qwen-Image 2.1 and Coqui XTTS-v2 are classified `RESEARCH_ONLY` from the
published non-commercial terms cited in the production blueprint. That
classification is **not** a signed legal opinion, and weight digests are not
in this document. Other checkpoints stay `UNCLASSIFIED`. `POST /v1/cartoon`
and `POST /v1/cartoon/edit` reject `commercial_export: true` with **403**
(`license_commercial_blocked`). A bad boolean is **400**.

Wan FLF (`wan2.1-flf2v`) and Wan 2.2 I2V (`wan2.2-i2v-a14b`) sample a **720p**
latent: native size `1280x720` (or `720x1280`), native **16 fps**
(`fps_native=16`, `size_native=1280x720`). The 720p UNet does not sample
1080p or 30 fps. Comfy's width and height step is 16, and 1080 is not a
multiple of 16, so `1920x1080` cannot be a latent. Request fields:

| Ask | What the file is | Job fields |
|-----|------------------|------------|
| `fps=30` | 16 fps latent, ffmpeg retimestamp, duration kept | `fps_native=16`, `fps_delivered=30`, `fps_delivery=ffmpeg` |
| `size=1920x1080` (or `video_size` on `POST /v1/cartoon`) | 1280x720 latent, ffmpeg scale to 1920x1080 | `size_native=1280x720`, `size_delivered=1920x1080`, `size_delivery=ffmpeg` |
| `size=1080x1920` | 720x1280 latent, ffmpeg scale | `size_native=720x1280`, `size_delivered=1080x1920` |

Catalog native for Wan FLF remains `1280x720` @ 16 fps when you ask for that
size. Hobby **short-beat** defaults on `POST /v1/cartoon` and director render
use `768x704` instead — that canvas has completed 2s beats on Spark GB10,
while full `1280x720` FLF has stalled mid-sample (~78%) through the 2400s
poll. `768x704` is not a relabel of 720p; `size_native` reports what Comfy
actually sampled. Explicit `video_size=1280x720` is still accepted.
`fps=16` and an explicit `size=1280x720` stay native (`fps_delivery` and
`size_delivery` are omitted). Other sizes above the 720p canvas are still
snapped and not upscaled (`size_requested`, no `size_delivered`).

Wan FLF / VACE length uses upstream `4n+1` frames. The default 2 second profile
at 16 fps is **33 frames** (2.0625 seconds of samples). The response field
`frame_contract.gpu_measured` stays false until a real render is probed.
Do not treat that number as a measured timing or as proof of a container duration.

`video_edit.ready` is true only when the VACE checkpoint scan says the model
is runnable. A filename that merely contains `vace` does not count as ready
and does not chain a restyle.

`packs.live_route` stays false: omitting pack ids leaves `POST /v1/cartoon`
on the sprite → slice → FLF path. Optional `character_pack_id`,
`style_pack_id`, `scene_id`, `project_id`, `profile`, and `character_class`
are checked before generation and echoed back. Unknown or other-owner ids
fail closed and do not start a render.

Director routes persist Project → Scene → Shot → Attempt → Artifact in sqlite
(`SPOCKIFY_CARTOON_STATE`, default under the router data directory). They
cover a scene brief, an editable shot plan, draft versus final profile,
approve, regen of one shot, cancellation, and a dialogue plan.

`POST /v1/cartoon/scenes/{scene_id}/render` dispatches **pending** shots to the
live sprite-grid → slice → Wan FLF path (optional VACE via `run_edit`). The
response includes real `/v1/videos/{id}` poll URLs. Approved shots are skipped,
so regenerating shot 3 does not resubmit shots 1–2. Chat Cartoon with a scene
brief and the + menu **Render pending shots** button use this route.

Render accepts **JSON or multipart**. Optional `character_plate` and
`background` (files or data-URLs) condition the Qwen contact sheet the same
way as `POST /v1/cartoon`. When those images are attached, the response
`identity_lock` is `qwen-reference` (not PuLID / look-still, and not a silent
prompt-only fallback).

If a shot has `dialogue`, render queues XTTS then LatentSync (`lip_sync` true
by default) after the FLF plate. Mouth failure falls back to mux or narration.
That is not a proven cartoon-lips claim. `POST /v1/cartoon/dialogue` still
returns the plan only (`gpu_executed=false`).

A nonhuman mouth that asks for lip sync is **422**. `production_ready` stays
false. Responses include `timing: not_estimated`, `usage: hobby_family`, and
never a countdown. `commercial_export` and `counsel_signed` stay false; a true
value is **403** (`license_commercial_blocked`). This path is hobby/family
cartoons, not commercial GA.

The canary character class `cel_human` is a reversible engineering default for
a simple human-mouth cartoon. It is not a creative sign-off and not a license.

## Constraints

- H3 remains atmos/scratch only.
- FLF is Wan (`wan2.1-flf2v`), not Wan 2.7 (no local 2.7 weights).
- Edit is **Wan VACE**, not Qwen-Video-Edit — label it honestly in UI and docs.
- Do not wipe live LabRats / Open Jealousy checkpoints to make room for larger edit packs.
