# LabRats production on Spockify

The frozen path is the three calls below. XTTS stays on CPU. MiniMax H3 is atmos and scratch only, not the A-camera. Open Jealousy extras (Illustrious, identity, Wan) sit beside this stack.

**Dialogue wording (frozen LatentSync, use this with Frank):** A dialogue clip is a silent Layout plate lip-locked to the finished XTTS VO with LatentSync. The look-still carries who is on screen. Mouths track the line via LatentSync lips only — not face reenactment beyond lips.

`GET /v1/series/policy` returns the frozen contract under `production` (`lip_sync: true`, method `layout-plate-plus-latentsync`, the three paths, and that claim). Bare ffmpeg mux remains available with `lip_sync=false` and is not the dialogue path.

## Where the calls go

| Call | Route |
|------|--------|
| Policy, speaker stems, assets | `GET/POST /v1/series/...` |
| New lines from a dry stem | `POST /v1/audio/speech` |
| Finished wav | `GET /v1/audio/speech/{stem_id}/content` |
| Silent Layout plate | `POST /v1/videos` |
| Dialogue (LatentSync) | `POST /v1/videos/lipsync` or `POST /v1/videos/mux` with `vo` (default) |
| Bare ffmpeg mux (not dialogue) | `POST /v1/videos/mux` with `lip_sync=false` |

`/v1/videos` (including `/v1/videos/mux` and `/v1/videos/lipsync`) is already public at `https://spockify.eu`. Series and `/v1/audio/speech` reach the router after this ingress file is applied, and only that file:

```bash
kubectl apply -f k8s/infra/spockify-spark-videos-api-ingress.yaml
```

Until then, port-forward the router and set `ROUTER` to it:

```bash
kubectl -n spockify port-forward svc/spockify-router 4100:4100
export ROUTER=http://127.0.0.1:4100
export KEY=sk-...   # chat Settings → Account key
```

After the ingress apply, `ROUTER=https://spockify.eu` is the same API. This is not the Open WebUI read-aloud route (`/api/v1/audio/speech`). That route does not store a series stem id for mux.

## 1. Voice factory

A dry stem becomes new lines in that voice. XTTS clone on CPU. If the speaker has a stem and XTTS is down, the call returns **503**. Edge is not called.

```bash
curl -sS -X POST "$ROUTER/v1/series/speakers/frank/sample" \
  -H "Authorization: Bearer $KEY" \
  -F "speaker_wav=@frank-dry.wav;type=audio/wav"

curl -sS -X POST "$ROUTER/v1/audio/speech" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"I can fix it!","speaker_id":"frank","language":"en"}'
```

The JSON body returns `engine: "xtts"` and an id like `vo_…`. Fetch the wav:

```bash
curl -sS "$ROUTER/v1/audio/speech/vo_REPLACE/content" \
  -H "Authorization: Bearer $KEY" \
  -o frank-line.wav
```

Speakers with no stem still use Edge (scratch). That path is not the factory.

**Accept**

- Automated: the clone path sends the ingested wav to XTTS. Edge is not called when a stem is present, including when XTTS is down (`503`).
- Human, not scored: play Frank's dry stem, one new Frank line, and one other speaker (Tim or Doc). Pass if a person hears the new Frank line as Frank rather than the other voice. Do not invent a timbre distance or automated score.

## 2. Dialogue performance (LatentSync)

Look-still plus a finished VO. The picture is a silent Layout plate. LatentSync lip-locks that plate to the XTTS wav. Identity is the still (Layout look-still + optional clay + Union). The line is LatentSync lips — not face reenactment beyond lips.

Plate (same call as a silent action plate, prompted for the line's action):

```bash
curl -sS -X POST "$ROUTER/v1/videos" \
  -H "Authorization: Bearer $KEY" \
  -F "prompt=Frank in the garage, turns toward camera" \
  -F "model=ltx-2.5-layout-to-render" \
  -F "size=1920x1088" \
  -F "seconds=5" \
  -F "fps=24" \
  -F "audio=false" \
  -F "input_reference=@frank-look.png;type=image/png"
```

Poll `GET /v1/videos/{id}` until `completed`. Then lip-sync (either endpoint):

```bash
# Preferred explicit route
curl -sS -X POST "$ROUTER/v1/videos/lipsync" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"video_id":"video_REPLACE","vo":"vo_REPLACE"}'

# Same result: mux defaults to LatentSync when vo is set
curl -sS -X POST "$ROUTER/v1/videos/mux" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"video_id":"video_REPLACE","vo":"vo_REPLACE"}'
```

The LatentSync job has `lip_sync: true`, `performance: "layout-plate-plus-latentsync"` (or engine `latentsync`), and the claim above. Poll that new id and download `GET /v1/videos/{id}/content`.

Bare ffmpeg (not dialogue):

```bash
curl -sS -X POST "$ROUTER/v1/videos/mux" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"video_id":"video_REPLACE","vo":"vo_REPLACE","lip_sync":false,"lufs":-14}'
```

**Accept**

- Catalog `lipsync.ready=true` (and/or video row `latentsync` `api_ready=true`).
- The frame still looks like the character in the look-still.
- The job is not silent-mux-only (`performance` is LatentSync / `layout-plate-plus-latentsync`, `lip_sync` true).
- Do not claim face reenactment beyond LatentSync lips.

## 3. Silent action plates

Look-still to silent Layout motion. Defaults come from policy: model `ltx-2.5-layout-to-render`, size `1920x1088`, `audio: false`, `audio_ignored: true`, max 10 seconds. A client that sends `audio=true` is ignored and the plate stays silent. The graph is not MiniMax H3, so dialogue is not baked into the picture.

```bash
curl -sS "$ROUTER/v1/series/policy" -H "Authorization: Bearer $KEY"

curl -sS -X POST "$ROUTER/v1/videos" \
  -H "Authorization: Bearer $KEY" \
  -F "prompt=Frank crosses the garage, no dialogue" \
  -F "model=ltx-2.5-layout-to-render" \
  -F "size=1920x1088" \
  -F "seconds=5" \
  -F "fps=24" \
  -F "audio=false" \
  -F "input_reference=@frank-look.png;type=image/png"
```

The look-still should already be on Layout's grid (1920×1088). Off-grid stills are rejected at `POST /v1/series/assets` when ingested as `kind=look-still`.

**Accept**

- The job `model` is `ltx-2.5-layout-to-render`, `audio` is false, and `audio_ignored` is true when audio was requested.
- The file has no audio stream.
- It is not an H3 clip (`series_role` `atmos-scratch` on that model only).

## Automated checks

From `services/router` (no GPU, no Comfy):

```bash
python -m unittest test_series_prod.py -v
```

What those tests lock:

- Clone synthesis reads the ingested stem and does not call Edge.
- Stem present and XTTS down → 503, Edge not called.
- Layout plate graph drops audio decode; H3 with audio keeps `VAEDecodeAudio`.
- Enqueue of a Layout plate with `audio=true` stores `audio: false`, `audio_ignored: true`, and does not start an H3 job.
- Default mux with `vo` routes to LatentSync when ready; `lip_sync=false` keeps ffmpeg mute-mux.

## Human listen (voice only)

1. Frank dry stem.
2. One new Frank line from the voice factory.
3. One other cast line (Tim or Doc).

Pass or fail by ear. No score is computed.


## Open Jealousy

`GET /v1/series/policy` adds `production.open_jealousy`. `open_jealousy.lip_sync_in_scope` is true. Frozen dialogue is LatentSync (`frozen_dialogue_lip_sync: true`). The cold catalogs `GET /__gateway/image-models` and `GET /__gateway/video-models` report what is actually ready. They do not call Comfy `/object_info`.

Ready on the API now:

- `illustrious-xl` (`Illustrious-XL-v0.1.safetensors`) on `POST /v1/images/generations`
- Identity `faceid`, `instantid`, and `pulid` (InsightFace antelopev2, IP-Adapter FaceID Plus V2, InstantID, PuLID + EVA-CLIP)
- ControlNet `openpose`, `depth`, and `lineart` via the SDXL Union net, with preprocessors
- Wan 2.2 I2V-A14B (`wan2.2-i2v-a14b`) preferred first-frame I2V; TI2V-5B remains the lighter fallback
- LatentSync lips (`latentsync`) on `POST /v1/videos/lipsync` / default mux

Ready when the Comfy image includes `/opt/LatentSync` and `loras/_oj/latentsync` has `latentsync_unet.pt` + `whisper/tiny.pt`: talking-head and LatentSync lips. Otherwise those routes return 503. See the skip table for Wan 2.7 / frank-café / LivePortrait.

### Illustrious-XL stills

`POST /v1/images/generations` with `model=illustrious-xl`, beside Qwen (`qwen-image-2.1`). Checkpoint `Illustrious-XL-v0.1.safetensors`. Long edge clamps to 1216 (not 2K).

```bash
curl -sS -X POST "$ROUTER/v1/images/generations" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"illustrious-xl","prompt":"cel of Doc at the counter, flat color","size":"1024x1024","loras":[{"id":"doc","strength":0.8}],"style_lora":"frank-cafe"}'
```

Per-character LoRAs are non-video safetensors in the Comfy `loras` directory, passed as `loras[].id` (filename stem). The series style slot is `style_lora=frank-cafe`. That file is not shipped. A missing style file returns 400.

Optional identity (`identity` = `faceid`, `instantid`, or `pulid`, plus `identity_image`) and control (`control` = `openpose`, `depth`, or `lineart`, plus `control_image`) are included only when the cold catalog says that pack is ready. Otherwise the call is 503. Do not send a Qwen edit `image` field with Illustrious.

### Identity and ControlNet

Wired into the Illustrious graph when the weights and the custom nodes are both present:

- IP-Adapter FaceID Plus (`identity=faceid`) with InsightFace antelopev2
- InstantID (`identity=instantid`)
- PuLID (`identity=pulid`, also needs EVA-CLIP)
- ControlNet OpenPose, Depth, and Lineart. An SDXL Union net covers those three when that is the file on disk

`open_jealousy.identity` / `open_jealousy.control` in the cold image catalog is the source of truth. A weight file without the matching custom node is not ready.

### Wan 2.2 action (I2V) and first+last frame

Preferred action image-to-video is **Wan 2.2 I2V-A14B** (`model=wan2.2-i2v-a14b`, UNETs `wan2.2_i2v_{high,low}_noise_14B_fp8_scaled.safetensors`). `input_reference` is required. Prompt, seconds, and size are clamped (max 5s, max 1280×704, 16 fps).

Wan 2.2 TI2V-5B (`wan2.2-ti2v-5b`) stays as the lighter first-frame fallback.

`end_image` / `last_frame` uses **Wan 2.1 FLF2V** (`model=wan2.1-flf2v`, UNET `wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors`) through Comfy `WanFirstLastFrameToVideo`. Sending `end_image` with an I2V/TI2V model id auto-routes to FLF when those weights are installed; otherwise the call is 400. Labeled honestly as Wan 2.1 FLF2V — **not Wan 2.7**. No local Wan 2.5 / 2.6 / 2.7 weights. Wan 2.2 T2V-A14B remains text-to-video (`wan2.2-t2v-a14b`).

```bash
curl -sS -X POST "$ROUTER/v1/videos" \
  -H "Authorization: Bearer $KEY" \
  -F "prompt=Frank walks from the door to the counter" \
  -F "model=wan2.2-i2v-a14b" \
  -F "seconds=2" \
  -F "size=832x480" \
  -F "input_reference=@start.png;type=image/png"

curl -sS -X POST "$ROUTER/v1/videos" \
  -H "Authorization: Bearer $KEY" \
  -F "prompt=Frank walks from the door to the counter" \
  -F "model=wan2.1-flf2v" \
  -F "seconds=2" \
  -F "size=1280x720" \
  -F "input_reference=@start.png;type=image/png" \
  -F "end_image=@end.png;type=image/png"
```

### Talking head

`POST /v1/videos/talking-head`

Inputs: `input_reference` (locked still), `audio` or `vo` (XTTS stem id), optional `prompt`.

Engine order when installed: LivePortrait, else a still held for the wav length and lip-locked with LatentSync. LongCat-Video-Avatar and Hallo weights are not installed. If nothing is ready the call is 503. Sending `model=liveportrait` to `POST /v1/videos` returns 400 and points at this route.

### Lips / ADR (dialogue path)

`POST /v1/videos/lipsync` is the LabRats dialogue lip-sync path. `POST /v1/videos/mux` with a `vo` defaults to the same LatentSync job. Keep XTTS as the VO factory.

```bash
# Catalog must show lipsync ready=true
curl -sS "$ROUTER/__gateway/video-models" -H "Authorization: Bearer $KEY" | jq '.models[] | select(.id=="latentsync")'

curl -sS -X POST "$ROUTER/v1/videos/lipsync" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"video_id":"video_REPLACE","vo":"vo_REPLACE"}'
```

`video_id` is a finished silent or soft-mouth plate. `vo` is an XTTS stem. `plate` and `audio` uploads work too. Preferred engine is LatentSync. MuseTalk is only used if those weights are the ones installed. Empty-body authenticated calls return **400** (missing inputs), not 503, when the lane is ready. If the runner or the checkpoint is missing the call is 503.

### Comfy ops

One GPU replica. Lanes are queue tags: `stills`, `wan`, `talk`, `lips`, `ltx`. They share one lock because a second replica does not fit. `GET /v1/videos/{id}` includes `lane`, `worker` (`comfy:<lane>`), and `worker_released`.

If Comfy’s step ratio stays at or under about 15% without changing for the lane window, the job is failed, Comfy is interrupted, and GPU memory is freed. Windows default to 8 min (stills), 12 min (talk/lips), 20 min (Wan), 35 min (LTX/Layout/H3). Override with `OPEN_JEALOUSY_STUCK_MINUTES`. Cancel interrupts Comfy, frees GPU memory, and releases the worker even when the job was still queued.

## Related: cartoon sprite → FLF

Short cartoon beats (not dialogue) use a separate lane: Qwen-Image contact sheet
→ deterministic tile slice → Wan `wan2.1-flf2v`. See `docs/CARTOON_PIPELINE.md`
and `POST /v1/cartoon`. Latent restyle is Wan 2.1 VACE 1.3B
(`wan2.1-vace-1.3b`, not Qwen) via `POST /v1/cartoon/edit` when that checkpoint
is actually ready. `GET /v1/cartoon/policy` sets `pipeline[video_edit].ready`
from the cold disk scan (`ready` is the runnable VACE checkpoint, not a stray
filename). Qwen-Video-Edit is not an installed edit path. This does not change
the frozen LatentSync dialogue path above.

## What was skipped

| Item | Reason |
| --- | --- |
| Wan 2.5 / 2.6 / 2.7 | No local weights (2.7 is Alibaba API only). Closest first+last-frame stack is Wan 2.1 FLF2V (`wan2.1-flf2v`). Strongest local I2V is Wan 2.2 I2V-A14B. |
| Frank café LoRA | Slot is wired (`style_lora=frank-cafe`). No public frank-café safetensors was found or named as a stand-in. Frank was emailed for the private file. Drop `frank-cafe.safetensors` into Comfy `loras/` when available. |
| LongCat-Video-Avatar, Hallo, LivePortrait | Weights and runners are not installed. Talking-head uses LatentSync (still→held plate→lips) when LatentSync is ready. |
| MuseTalk | Not installed. LatentSync is the preferred lips engine. |
| LatentSync 1.6 / stage2_512 | Skipped for VRAM/disk. Spark uses LatentSync 1.5 (`stage2.yaml`, 256px, ~8 GB VRAM). |
| MiniMax H3 repair | Optional and unchanged. Not required for this stack. |
| Chat image picker row | The web composer still uses the catalog baked into the chat image. The API and `GET /__gateway/image-models` list Illustrious. |

Poll `GET /v1/videos/{id}` and download `GET /v1/videos/{id}/content`. Image bytes come back as `b64_json`.
