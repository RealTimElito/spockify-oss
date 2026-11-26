# Cartoon pipeline roadmap — top-tier mostly-cartoon

**Status:** plan only (no greenwash claims).  
**Companion:** [`docs/CARTOON_PIPELINE.md`](./CARTOON_PIPELINE.md) (live API contract), [`docs/LABRATS_PRODUCTION.md`](./LABRATS_PRODUCTION.md) (dialogue / Layout / LatentSync frozen path).  
**Execution tracker:** [`docs/cartoon-production/EXECUTION_STATUS.md`](./cartoon-production/EXECUTION_STATUS.md) (private; not on the OSS keep-list).  
**Audience:** Tim (ops) + Frank (creative). OSS-safe: no private hosts, LAN IPs, emails, or product-marketing GPU names.

---

## Executive summary (paste to Frank)

1. **Today works as a short-beat demo:** one Qwen contact sheet → equal-tile slice → Wan FLF clip(s), optional Wan VACE restyle, Cartoon toggle in chat + menu.
2. **Not yet a director’s tool:** no character bible, no multi-beat timeline, no lip-sync on cartoon plates, no seed/style lock across shots, OWUI hardcodes `2×2` / `first_last`.
3. **Honest model stack (local only):** Qwen-Image grids; Wan 2.1 FLF for keyframe pairs; Wan 2.2 I2V-A14B for single-still action; Wan VACE for latent restyle; Layout/Union for photoreal/identity plates (LabRats); H3 atmos/scratch only — never A-cam for cartoon dialogue.
4. **Next week leverage:** harden grid adherence + gutter slice; expose grid/pair/edit in Cartoon UX; single parent cartoon job with stage chips + cancel; wire adjacent FLF → ffmpeg timeline concat.
5. **Then:** character ref pack (look sheet + optional IP-Adapter/PuLID on stills); beat sheet → N shots; LatentSync + XTTS on cartoon silent plates; seed/style continuity.
6. **Later / Tim-gated:** Qwen-Video-Edit only if disk allows without wiping LabRats/Open Jealousy; optional LoRA style packs (not frank-café); human consistency rubric + canary clips.
7. **Non-goals:** frank-café LoRA; cloud MiniMax; claiming Wan 2.7 / 2.5 / 2.6 without weights; fake H3 48 fps; “enterprise / top-tier %” without scored canaries.
8. **GPU reality:** one Comfy lock; cartoon defaults stay ~2s @ ≤1280×720 FLF / 832×480 VACE; queue honestly; pin/Comfy coexistence unchanged.
9. **Ship bar:** creators can brief a short cartoon scene, get a multi-shot cut with VO/lips where needed, cancel stuck stages, and see stage progress — without leaving the chat composer.
10. **DoD language:** every phase below has Accept checks; no phase is “done” on API shape alone.

---

## Current reality (read this before changing anything)

### Live (code + cold policy)

| Surface | What exists |
|--------|-------------|
| `GET /v1/cartoon/policy` | Cold stages: `sprite_grid` → `slice` → `flf` → `video_edit` |
| `POST /v1/cartoon` | Qwen contact sheet → ffmpeg equal-tile slice → enqueue Wan `wan2.1-flf2v`; `pair_mode` `first_last` \| `adjacent`; `run_edit` chains Wan `wan2.1-vace-1.3b` async after FLF |
| `POST /v1/cartoon/slice` | Crop-only |
| `POST /v1/cartoon/edit` | Wan VACE V2V (multipart video / `video_id` / b64) |
| Catalog | `wan2.1-flf2v` (~720p, max 5s, 16 fps); `wan2.1-vace-1.3b` (default 832×480, `video_edit_supported`) |
| OWUI | + / more **Cartoon** toggle → `POST /v1/cartoon` via router client; progress status events |
| LabRats (separate lane) | XTTS VO, Layout silent plates, LatentSync lips, `/v1/videos/timeline` concat + LUFS mux, stuck-job fail + cancel→Comfy `/interrupt` |
| Open Jealousy (separate lane) | Illustrious stills, FaceID/InstantID/PuLID, ControlNet, Wan 2.2 I2V-A14B |

### Partial / thin

| Gap | Detail |
|-----|--------|
| OWUI Cartoon | Toggle only; `spockify_cartoon_grid` / `pair_mode` hardcoded `2x2` / `first_last`; `run_edit` forced false; no beat editor |
| Attach-intent | Resolves `i2v` \| `edit` \| `none` — **no cartoon awareness** (Cartoon toggle wins over plain video when on) |
| Multi-shot | `adjacent` returns N FLF job ids; **no parent series job**, no auto-concat, no hold/ease |
| Consistency | Prompt text only (“same character…”); no seed API, no ref-sheet bind, no cross-shot style id |
| VACE chain | Fire-and-forget tasks; client must poll FLF then discover edit jobs — weak observability |
| Docs drift | `LABRATS_PRODUCTION.md` still says video edit “staged until VACE”; `CARTOON_PIPELINE.md` + code treat VACE as the installed edit path when weights are on disk |

### Missing (top-tier blockers)

- Character bible / style lock package  
- Beat sheet → multi-beat cartoon timeline API  
- Grid adherence QA (gutters, panel count, OCR-free)  
- FLF hold frames / ease curves between pairs  
- Cartoon ↔ LatentSync + XTTS as first-class stages  
- Director UX (beats, grid, pair, edit pass, stage chips, ETA)  
- Eval rubric + canary regression set  
- Qwen-Video-Edit (~55 GiB) — blocked without wiping other packs  

---

## Model ranking — when to use which

Local-only; prefer smaller / shorter first.

| Rank | Model / path | Use for | Avoid for |
|------|----------------|---------|-----------|
| 1 | **Qwen-Image 2.1** | Sprite / contact grids, style stills, 1K default / 2K when needed | Photoreal identity lock (use Illustrious + adapters) |
| 2 | **Wan 2.1 FLF2V** | Cartoon keyframe→keyframe motion (sprite tiles, pair chains) | Long dialogue A-cam; single still without end frame |
| 3 | **Wan 2.2 I2V-A14B** | Single look-still → short action (≤5s, ≤~1280×704) | End-frame interpolation (route to FLF) |
| 4 | **Wan 2.1 VACE 1.3B** | Motion-coherent restyle / latent edit of an existing short clip | Branding as “Qwen edit”; long masters |
| 5 | **Layout / Union** | LabRats silent plates, look-still identity, control video | Default cartoon cel beats (heavier; different look) |
| 6 | **H3 (+ turbo LoRA)** | Atmos / scratch audio-aware B-roll only | Cartoon dialogue, fake 48 fps, A-cam |
| 7 | **LatentSync + XTTS** | Dialogue mouths on silent plates | Face reenactment claims beyond lips |
| — | **Qwen-Video-Edit** | Future instruction V2V when disk allows | Do not wipe LabRats/OJ to install |
| — | **Wan 2.7 / 2.5 / 2.6** | N/A locally | Never claim |

### Resolution / fps / duration policy (do not melt the GPU)

| Stage | Default | Hard ceiling | Notes |
|-------|---------|--------------|-------|
| Qwen grid canvas | 1536×1536 | Qwen 2K long edge | Prefer 2×2 over 3×3 for first ship |
| FLF clip | 2s @ 1280×720 @ 16 fps | 5s; max pixels catalog | Adjacent mode = N× cost |
| VACE edit | 2s @ 832×480 @ 16 fps | 5s | Smaller than FLF on purpose |
| Wan I2V A14B | ≤5s, ≤~1280×704, 16 fps | Catalog clamp | |
| Layout plate | ≤10s @ 1920×1088 @ 24 fps | LabRats policy | Silent for dialogue path |
| H3 | ≤15s; default 1344×768; 1920×1088 stand-in @ 24 fps | No native 48; 1080 snaps +8; 768p turbo LoRA | Atmos only |
| Post upscale / RIFE | Opt-in after approve | Never default | Only when it helps; never stamp H3 as 48 |

**Honest latency budgets (order-of-magnitude, single GPU, warm weights):**  
sprite grid 30–90s · slice &lt;2s · FLF 2s@720p 2–8 min · VACE 1–5 min · LatentSync short 1–4 min · timeline mux &lt;30s. Cold load adds minutes. Adjacent 3×3 = many FLF jobs — ETA must multiply.

---

## Non-goals (explicit)

- frank-café / `style_lora=frank-cafe` (slot may stay wired elsewhere; **out of this roadmap**)  
- Cloud MiniMax or any `:cloud` video API  
- Claiming Wan 2.7 (or 2.5/2.6) without local weights  
- Fake pass rates, “beats X”, or greenwash % without canary rows  
- Replacing LabRats frozen LatentSync dialogue with H3 baked mouths  
- Wiping LabRats / Open Jealousy checkpoints for Qwen-Video-Edit without Tim disk decision  
- Parallel Comfy replicas / second GPU lock assumptions  

---

## Phased roadmap

Legend: **Agent** = agent-shippable with Accept tests · **Tim** = Tim-gated (disk, deploy image, creative sign-off, or GPU soak).

---

### Phase 0 — Truth & contracts (this week)

**Goal:** One honest SoT so Frank and agents share the same map.

| Work | Owner |
|------|--------|
| Keep `CARTOON_PIPELINE.md` as live API SoT; this file as plan SoT | Agent |
| Fix doc drift: LabRats “video edit staged” → point at VACE ready when catalog says so | Agent |
| Export allowlist: keep `CARTOON_PIPELINE_ROADMAP.md` next to `CARTOON_PIPELINE.md` | Agent |
| Snapshot cold `GET /v1/cartoon/policy` + video catalog rows into a canary fixture (no GPU) | Agent |

**DoD**

- [ ] Policy JSON lists four stages; `video_edit.ready` matches disk scan  
- [ ] No doc claims Wan 2.7 or Qwen-Video-Edit as live  
- [ ] OSS export retains both cartoon docs  

Phase 0 is not closed. The export script already names both cartoon docs. Live GPU-host policy, weight digests, and a full export run are tracked in `docs/cartoon-production/`, not checked off here.  

---

### Phase 1 — Creative spine foundations (next week, high leverage)

**Goal:** Better keyframes + a real multi-clip cut from what already ships.

#### 1A. Grid adherence & slice (Agent)

- Tighten sprite prompt presets (gutter language, equal panels, no text)  
- Default `gutter_ratio` tuned from real Qwen sheets (keep OCR-free — no panel number OCR)  
- Optional post-check: tile count, min cell size, variance flag (warn, don’t invent panels)  
- Regression: synthetic grid unit tests already exist — add 1–2 fixture sheets if available  

**DoD:** 2×2 and 3×3 slices produce stable L→R/T→B tiles; gutter doesn’t eat characters on fixture sheets; failure is 400 with reason, not silent bad crops.

#### 1B. Parent cartoon job + adjacent timeline (Agent)

- Extend run card to a first-class job object: `cartoon_{id}` with `stages[]`, child `video_ids`, `status`, `cancel`  
- When `pair_mode=adjacent`, after FLF completes → ffmpeg concat (reuse series timeline stitch; silent; optional −14 LUFS later)  
- Progress fields: `stage` ∈ `grid|slice|flf|edit|mux`, rough `eta_s` from budgets × queue depth  
- Cancel parent → cancel children + Comfy interrupt (same semantics as `/v1/videos/{id}/cancel`)  

**DoD:** One poll URL for a multi-clip adjacent run; completed master mp4 when all FLF ok; cancel frees GPU; unit tests without Comfy for state machine.

#### 1C. Composer director chrome (Agent + Tim UX glance)

- Cartoon submenu or inline controls: grid `2x2|3x3`, pair `first_last|adjacent`, optional **Edit pass** (`run_edit`)  
- Stage chips in chat status (reuse existing cartoon status events; add stage ids)  
- Keep + / more placement; no main-bar chip sprawl  

**DoD:** Chat can request adjacent 2×2 without API curl; edit off by default; controls don’t break mobile simple layout.

#### 1D. Attach-intent + cartoon awareness (Agent)

- If Cartoon on → stay on cartoon path (already priority)  
- If attach + cartoon language (“turn this sheet into a cartoon”, “animate these panels”) → prefer cartoon/slice+FLF over plain I2V when a grid-like still is attached  
- Document precedence: Cartoon toggle &gt; attach i2v &gt; video toggle  

**DoD:** Unit tests for intent precedence; no silent double-generation.

---

### Phase 2 — Consistency & character bible (weeks 2–4)

**Goal:** Same fox across shots without hoping the prompt remembers.

| Work | Owner |
|------|--------|
| **Character pack** API: upload look sheet / turnaround / 1–3 refs; store under cartoon assets; return `character_id` | Agent |
| Bind `character_id` + optional `style_id` + `seed` on `POST /v1/cartoon` | Agent |
| Still path: Qwen with ref image when supported; Illustrious + IP-Adapter/PuLID/InstantID only when catalog ready (OJ packs) — cartoon-cel default stays Qwen | Agent |
| Style lock string + negative prompt presets (cel / ink / flat) versioned in policy | Agent |
| Anti-drift: reuse seed across adjacent FLF pairs; pass prior end tile as next start (already adjacent); optional hold frame (duplicate last tile N frames) before next pair | Agent |
| LoRA-optional **later**: generic style LoRAs only when files exist — **not frank-café** | Tim |

**DoD**

- [ ] Two runs with same `character_id` + seed produce visibly closer identity than two cold prompts (human A/B, not a fake %)  
- [ ] Policy exposes `character` / `style` readiness  
- [ ] Missing identity packs → 503 with catalog reason, not silent degrade  

---

### Phase 3 — Beat sheet → multi-shot show (weeks 3–6)

**Goal:** Not one 2s clip — a short scene.

| Work | Owner |
|------|--------|
| `POST /v1/cartoon/series` (or extend `/v1/cartoon`): body = ordered **beats** `{prompt, seconds?, grid?, dialogue?}` | Agent |
| Planner (optional LLM): beat sheet from one paragraph → structured beats (cap 4–6 for GPU) | Agent + Tim prompt review |
| Per beat: grid→slice→FLF (or single I2V if one still); then timeline concat | Agent |
| Hold / ease: configurable overlap_s, optional freeze frames between beats | Agent |
| Job observability: per-beat stage chips + overall ETA | Agent |

**DoD**

- [ ] 3-beat request yields one master + per-beat artifacts  
- [ ] Cap / reject oversize beat counts with clear 400  
- [ ] Cancel mid-series stops further enqueues and interrupts active Comfy  

---

### Phase 4 — Audio & lips on cartoon beats (weeks 4–7)

**Goal:** Dialogue cartoons without abandoning cel path.

| Work | Owner |
|------|--------|
| Per-beat optional `dialogue` + `speaker_id` → XTTS (CPU) → silent plate strategy | Agent |
| Cartoon silent plate: prefer FLF/I2V cel plate; LabRats Layout only when identity pack demands it | Agent + Tim |
| LatentSync lips on that plate (`/v1/videos/lipsync`); bare mux only if `lip_sync=false` | Agent |
| Atmos: optional H3 B-roll under mux; never replace VO | Agent |
| Final −14 LUFS mux via existing timeline helpers | Agent |

**DoD**

- [ ] One dialogue beat: VO heard, mouths move, identity from look/ref still holds  
- [ ] Policy claim matches LabRats honesty (lips only, not face reenactment)  
- [ ] XTTS down + stem present → 503 (no Edge fake for factory speakers)  

---

### Phase 5 — Edit quality & restyle path (ongoing; Tim-gated disk)

| Work | Owner |
|------|--------|
| Harden VACE: expose edit job ids on parent cartoon job; pollable `video_edit` children | Agent |
| Quality presets: light restyle vs strong style transfer; size clamp | Agent |
| **Qwen-Video-Edit** install decision only if free disk ≥ ~60 GiB without wiping LabRats/OJ | **Tim** |
| Until then: VACE remains the honest edit model in UI copy | Agent |

**DoD:** UI/docs never say “Qwen edit” for VACE; when Qwen-Video-Edit lands, policy `candidates` flip `ready` with real id.

---

### Phase 6 — Reliability & perf (parallel with 1–4)

| Work | Owner |
|------|--------|
| Cartoon jobs honor single GPU lock + lane tags (`wan` / `stills` / `lips`) | Already mostly true — verify | Agent |
| Stuck-job windows for FLF/VACE match Wan lane; cancel → interrupt + worker_released | Agent |
| Warm path: document default weight set for cartoon (Qwen UNet+VAE+CLIP, FLF, optional VACE); no forced pin fight with chat gpt-oss beyond existing Comfy evacuation rules | Tim ops |
| Cache: reuse sprite grid bytes on retry; don’t regenerate grid when only FLF failed | Agent |
| Queue depth in policy / job status for honest ETAs | Agent |

**DoD:** Cancelled cartoon leaves Comfy interruptible and lock free; retry from failed stage without full redo when artifacts exist; no second replica assumed.

---

### Phase 7 — Eval / quality bar (start after Phase 1B)

**How we know it’s “top tier” without greenwash**

| Rubric axis | Method | Pass bar |
|-------------|--------|----------|
| Character consistency | Human 1–5 on fixed cast canary; optional embedding distance later | Median ≥ 4 on 5 canaries |
| Grid adherence | Panel count / gutter crop QA + human glance | No merged panels; no text labels |
| Motion coherence | Human watch adjacent chain | No teleport; identity holds |
| Lip sync | LabRats human listen + mouth glance | VO match; no silent “success” |
| Latency honesty | Logged stage times vs budget | ETA within 2× of actual on warm runs |
| Regression | Fixed prompt pack in repo (`packs/cartoon-canary-v1.json` or similar) | Agent can re-run; store clips off-git or hashed |

**Rules:** N=1 resolve is evidence, not a board %. No “beats OpenHands / enterprise ready” language. Canary red after a harness/pipeline PR → revert, don’t prompt-salvage.

**DoD:** Canary pack checked in; human scorecard template; CI unit tests for policy/slice only (GPU canaries are Tim-scheduled).

---

## Suggested order (leverage)

```text
Week 1     Phase 0 + 1A + 1B + 1C (truth, slice, parent job, OWUI controls)
Week 2     Phase 1D + Phase 6 cancel/ETA harden + start Phase 7 canary stubs
Weeks 2–4  Phase 2 character pack + seed lock
Weeks 3–6  Phase 3 beat sheet / series
Weeks 4–7  Phase 4 lips + VO on cartoon beats
Ongoing    Phase 5 VACE UX; Tim gate on Qwen-Video-Edit disk
```

**Agent-shippable now:** Phases 0, 1, most of 6, canary stubs.  
**Tim-gated:** OWUI image rebuild/deploy for composer controls; disk for Qwen-Video-Edit; creative sign-off on character bible + canary scores; any prod Comfy weight install.

---

## Product / API / UI target shape

```text
GET  /v1/cartoon/policy          # stages, defaults, readiness, latency hints
POST /v1/cartoon                 # single beat (today) → evolve to parent job
POST /v1/cartoon/series          # multi-beat (Phase 3)
POST /v1/cartoon/slice
POST /v1/cartoon/edit            # VACE (Qwen-Video-Edit later)
GET  /v1/cartoon/{id}            # parent status, stage chips, children, ETA
POST /v1/cartoon/{id}/cancel
```

Composer: Cartoon mode = director strip (beats count or simple prompt, grid, pair mode, edit pass, optional character). Stage chips: `grid → slice → flf → edit → lips → mux`.

---

## Mapping to Tim’s spine (A–F)

| Req | Phase |
|-----|--------|
| A1 Character bible / style lock | 2 |
| A2 Qwen grids + deterministic slice | Live + 1A |
| A3 Beat sheet → multi-shot | 3 |
| A4 FLF multi-keyframe, hold, ease | Live adjacent + 1B/3 |
| A5 VACE → Qwen-Video-Edit path | Live VACE + 5 |
| A6 Lip-sync in cartoon beats | 4 |
| A7 Audio VO / atmos / LUFS | 4 (+ LabRats today) |
| A8 Consistency / anti-drift | 2 |
| B Models & quality policy | Ranking section + 6 |
| C API / UI / attach / observability | 1B–1D, 3 |
| D Reliability & perf | 6 |
| E Eval bar | 7 |
| F Phasing / non-goals | This doc |

---

## Related code (orientation)

- Router: `services/router/cartoon_pipeline.py`, routes on `/v1/cartoon*`, `video_gen.py`, `series_prod.py`  
- Catalog: `services/router/image_models.py` (FLF / VACE limits)  
- OWUI: `utils/videos/cartoon.py`, middleware cartoon handler, IntegrationsMenu Cartoon toggle  
- Tests: `services/router/test_cartoon_pipeline.py` (no live Comfy)

---

## Footer — OSS export

`scripts/export-oss.sh` keep-lists both `docs/CARTOON_PIPELINE.md` and
`docs/CARTOON_PIPELINE_ROADMAP.md` (stash into `.oss-keep`, then restore under
`docs/`). `docs/cartoon-production/` is intentionally absent from that keep-list
until a separate secrets review. A full export run is not a release gate.
