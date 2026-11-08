# LabRats frozen production path

Three calls, already on the Spark router. No extra models. XTTS stays on CPU. MiniMax H3 is atmos and scratch only, not the A-camera.

**Dialogue wording (use this with Frank):** A dialogue clip is a silent Layout plate with the finished VO muxed on the timeline. The look-still carries who is on screen. Mouths do not track the line. This is not lip-sync.

Out of scope: extra models, Edge expansions, per-character hacks, Wav2Lip, LatentSync, MuseTalk.

`GET /v1/series/policy` returns the same contract under `production` (`lip_sync: false`, the three paths, and that claim).

## Where the calls go

| Call | Route |
|------|--------|
| Policy, speaker stems, assets | `GET/POST /v1/series/...` |
| New lines from a dry stem | `POST /v1/audio/speech` |
| Finished wav | `GET /v1/audio/speech/{stem_id}/content` |
| Silent Layout plate | `POST /v1/videos` |
| VO onto that plate | `POST /v1/videos/mux` |

`/v1/videos` (including `/v1/videos/mux`) is already public at `https://spockify.eu`. Series and `/v1/audio/speech` reach the router after this ingress file is applied, and only that file:

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

## 2. Dialogue performance

Look-still plus a finished VO. The picture is a silent Layout plate. ffmpeg muxes the VO onto that picture and loudness-targets −14 LUFS. Identity is the still. The line is on the timeline.

Same claim as the top of this doc: mouths do not track the line. This is not lip-sync. Do not describe the clip as the character mouthing the line.

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

Poll `GET /v1/videos/{id}` until `completed`. Then mux the voice-factory stem:

```bash
curl -sS -X POST "$ROUTER/v1/videos/mux" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"video_id":"video_REPLACE","vo":"vo_REPLACE","lufs":-14}'
```

The mux job is `worker: "ffmpeg"`. Its record has `lip_sync: false`, `performance: "silent-layout-plate-plus-ffmpeg-mux"`, and the claim above. Poll that new id and download `GET /v1/videos/{id}/content`.

**Accept**

- The frame still looks like the character in the look-still.
- The VO is the audio on the timeline (`ffprobe` shows one audio stream).
- Do not accept or reject on mouth shape.

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
- Mux output has one audio stream, picture audio is not kept as a second stream, and the job claim says this is not lip-sync.

## Human listen (voice only)

1. Frank dry stem.
2. One new Frank line from the voice factory.
3. One other cast line (Tim or Doc).

Pass or fail by ear. No score is computed.
