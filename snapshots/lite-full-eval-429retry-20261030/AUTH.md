# Docker Hub auth / rate limit — Spock 2026-10-30

## Auth path used
- **None.** No Hub login available non-interactively.
- `~/.docker/config.json` auths: `ghcr.io` only (no `https://index.docker.io/v1/`).
- No `DOCKER_HUB_*` env, no `pass` docker entry, no hub token files, no netrc for docker.io.
- gh logged in to GitHub only — not Docker Hub.

## Rate limit (anonymous probe)
- Endpoint: `registry-1.docker.io` `ratelimitpreview/test`
- Observed: `x-ratelimit-limit: 100;w=3600` · `x-ratelimit-remaining: 100` (19:30 local)
- Window: **60 minutes** (not the older 6h folklore)
- Cooldown strategy: batch ≤80 pulls, then wait until remaining recovers (≥65m if exhausted)

## Local images
- 0 `swebench/sweb.eval*` present at retry start (pruned after prior board)
