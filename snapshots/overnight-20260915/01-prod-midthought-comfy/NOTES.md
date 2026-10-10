# 01 — prod mid-thought verify + comfy on-demand (2026-09-15 ~22:50 CEST)

## Prod mid-thought status
- **Working: Y** (module + env on Spark before and after hotfix)
- Before: `spockify-router:midthought-202609082212`, `MIDTHOUGHT_SPAWN_ENABLED=1`, `SPOCKIFY_HOST_PROFILE=spark`, cap 3, High/Medium eligible, Heavy/Off not
- After hotfix: `spockify-router:midthought-202609152247` (stricter SPAWN prompts ≥40 chars / ≥6 words, DONE OUTCOME digests, cooler SPAWN worker temp 0.35, reasoning salvage in parallel_agents)
- OWUI: `spawn-label-202609082015` (pending local panel polish: "Spawn workers…" / "Merging workers…")
- XTTS: stayed replicas=1 through router + OWUI env roll

## bd1582 inventory → prod port
Agent `bd1582b8-89f3-4b3d-9c1b-dc5b097aa104` is the long parent (OSS compose kit, IDE 0.9.16, coding-only Auto, search=8, Fedora GPU). Product bits from that line + Sep 8 overnight:
| Item | Twin/lab only? | Prod action tonight |
|------|----------------|---------------------|
| Mid-thought SPAWN A–D + prompt/digest tune | No | Hotfixed router `midthought-202609152247` |
| OWUI spawn labels / thinking chips | No | Image already; further panel polish queued |
| Comfy on-demand gateway | No | **Deployed** gateway 1, GPU comfy 0 |
| Lab-agents / dual-role / abliterated | **Yes** | Not on prod defaults |
| Lab CLI REPL / IDE lab register | Twin install path | In working tree; not required for chat SPAWN |

## Comfy on-demand
- `comfyui-gateway` 1/1, `comfyui` 0, `comfyui-backend` svc created
- Gateway status: `ok=true, backend_up=false, wake_enabled=true, idle_minutes=15`
