# Mid-thought SPAWN (phases A–D)

**Status:** implemented (router + OWUI chips + IDE SSE + compose caps)  
**Module:** `services/router/midthought_spawn.py` · wired in `main.py` stream path  
**Reuse:** Heavy run store (`parallel_agents.py`), `agents_meta_sse`, cancel APIs

## Locked decisions

1. **Merge:** same parent model, second pass with DONE digests (warm weights). Lighter merge only if `memory_guard` refuses a large parent reload — not a default third model.
2. **Caps:** Spark **3** / compose·OSS **2** concurrent children (`SPOCKIFY_HOST_PROFILE`, `MIDTHOUGHT_SPAWN_MAX_*`). **Max 1 spawn round** per user turn.
3. **Chips:** High **and** Medium/Auto when structured `SPAWN_CHILDREN` / `SPAWN` args are clear (quality filter; not spammy).
4. **IDE:** consume router SSE `spockify_agents` → agent run cards. Keep `spockify_create_agent_run` for Agent **tool-turns** only (no double-orchestrate).
5. **Phase B:** **segmented think** — break parent stream when SPAWN JSON completes; don’t wait on Ollama in-think pause.
6. **Heavy** 4-role ensemble unchanged.

## Phase map

| Phase | Shipped |
|-------|---------|
| **A** | Hint → parent buffers content → parse SPAWN → children via run store → same-parent merge; Thought chips via `agents_meta_sse` |
| **B** | Mid-stream segment break when SPAWN marker completes; keepalive + live chips while Thought open |
| **C** | Compose env `SPOCKIFY_HOST_PROFILE=compose`, max 2, leaner child models; catalog-aware / flagable |
| **D** | IDE: `ChatStreamChunk.spockifyAgents` → `agents` runtime event → agentRunCard HUD |

## How to test

**Web (Spark):** Thinking **High** (or Medium), ask e.g.  
`Compare NestJS vs FastAPI vs Go chi for a small authenticated API — research each in parallel and recommend one.`  
Expect: Thought stays open → Spawn chips → merge answer. Cancel via Agents cancel if needed.

**Medium:** Same prompt; SPAWN only if model emits clear structured args (may answer solo).

**Compose:** `SPOCKIFY_HOST_PROFILE=compose` (default in `docker-compose.yml`); cap 2.

**IDE:** Chat High with same prompt; agent run card / status line updates from SSE (not a second `spockify_create_agent_run`).

**Off / Voice / Heavy / Tab:** unchanged — Off never `think=`; Voice skips SPAWN; Heavy stays ensemble; Tab/FIM untouched.

## Hotfix router (Spark)

```bash
# from repo root — rsync + on-box image + set image only (no full deploy yaml)
rsync -az --delete services/router/ tim@example.local:/tmp/spockify-router-src/
ssh tim@example.local 'cd /tmp/spockify-router-src && sudo microk8s ctr images …'  # use your usual on-box build
# then: kubectl -n spockify set image deploy/router router=…:<tag>
```

Prefer existing project hotfix script if present (`scripts/deploy.sh` patterns / prior router hotfix notes). Never `make deploy-spark` for this.

## CLI

Lab mode already uses DONE digests. Regular CLI: spawn status rides the same router SSE when pointing at Spark/compose router; no separate orchestrator.
