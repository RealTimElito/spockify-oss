# Lab twin startup (after shutdown / reboot)

**Host:** `lab@lab-example.local` (`10.0.0.10`)  
**Repo on twin:** usually `~/agentHub` (laptop copy: `/workspace/spockify`)  
**Storage:** `/var/lib/spockify` on NVMe  
**Namespace:** `spockify` (MicroK8s)

**Yes — safe to shut down and power back up**, with caveats below. There is no systemd boot ensure (same as prod host). After power-on you must wait for MicroK8s, then run ensure scripts by hand.

Optional: copy or symlink this file on the twin for quick find:

```bash
ln -sf ~/agentHub/docs/LAB-TWIN-STARTUP.md ~/STARTUP.md
```

Prod host (`ops@example.local`) uses `make ensure-spark-boot` only — see private prod boot docs (not in this mirror). Do **not** run `lab-ensure-twin.sh` on prod.

---

## Safety / caveats

| Safe | Caveat |
|------|--------|
| Cluster state in etcd (secrets, CMs, intended replicas) | No auto ensure after boot — you run it |
| Data on NVMe (`/var/lib/spockify`: postgres, models, downloads, …) | Wait for MicroK8s ready before poking pods |
| Intended scale: XTTS=1, `comfyui-gateway`=1, `comfyui`=0 | Hotfix / scale drift: re-assert with `lab-ensure-twin.sh` |
| NodePorts usually stick (OWUI `:30080`, LiteLLM `:30400`, router `:30100`, downloads `:30980`) | LiteLLM NodePort re-patched by ensure if needed |
| Ollama GPU via runtimeClass | `nvidia-device-plugin` may CrashLoop — ignore if Ollama still sees GPU |
| ComfyUI on-demand (cold until image/video) | First gen after idle can take minutes |

Ensure scripts **never auto-restore** Postgres. If persistence verify fails, fix or restore explicitly (`docs/USER_ACCOUNTS.md`, `make backup-postgres` / restore tools).

---

## Shutdown

On the twin (graceful):

```bash
sudo shutdown -h now
# or: sudo systemctl poweroff
```

Optional before power-off (not required for safety):

```bash
microk8s kubectl get pods -n spockify
# confirm nothing critical mid-migration; stop long lab/bench jobs
```

Data stays on NVMe. Uncommitted overnight lab-agents tip lives in the **git working tree**, not in cluster state — reboot does not lose it if the disk is fine; sync/commit separately if you care about the tip.

---

## Power-on checklist

### 1. Wait for the box + MicroK8s

SSH when the host answers:

```bash
ssh lab@lab-example.local   # or lab@10.0.0.10
```

Then:

```bash
microk8s status --wait-ready
# often 1–5+ minutes after cold boot
```

### 2. Core boot ensure (persistence + unhealthy deploys)

From the twin repo checkout:

```bash
cd ~/agentHub   # or wherever the twin clone lives
SPOCKIFY_LAB_TWIN=1 make ensure-spark-boot
```

What this does (`scripts/ensure-spark-boot.sh`):

- waits for MicroK8s; checks storage under `/var/lib/spockify`
- refuses boot if Postgres dir missing/tiny (no auto-restore)
- `verify-persistence` with **MIN_USERS=1** on the twin
- requires LiteLLM `DISABLE_SCHEMA_UPDATE`
- re-applies / scales **XTTS → 1**; restarts core deploys that are not ready (`openwebui`, `litellm`, `ollama`, `spockify-router`, `searxng`, `xtts`)

### 3. Twin overlays (always run after reboot)

```bash
./scripts/lab-ensure-twin.sh
# From a non-twin hostname (e.g. laptop SSH session wrongly detected):
#   SPOCKIFY_LAB_TWIN=1 ./scripts/lab-ensure-twin.sh
```

What this does (`scripts/lab-ensure-twin.sh`):

- OWUI: `OFFLINE_MODE=true`, `WEBUI_URL=http://lab-example.local:30080`, insecure session cookies for LAN HTTP
- persistence CronJob `MIN_USERS=1`
- LiteLLM NodePort `:30400` (`lab-expose-litellm-nodeport.sh`)
- dual-role aliases (`lab-wire-benign-models.sh` + `lab-set-dual-roles.sh`)
- scale: **xtts=1**, **comfyui-gateway=1**, **comfyui=0**
- best-effort background warm of a few coder tags

**Recommended order:** `ensure-spark-boot` → `lab-ensure-twin.sh`.  
If core pods already look healthy, `lab-ensure-twin.sh` alone re-asserts twin-specific bits.

### 4. Smoke checklist

| Check | Expect |
|-------|--------|
| Pods | Core Ready; `comfyui` may be 0/0; gateway + xtts 1 |
| OWUI | `http://lab-example.local:30080` loads; login works |
| LiteLLM | `:30400/v1/models` with master key |
| Ollama | `ollama list` in pod; GPU usable despite device-plugin noise |
| XTTS | deploy replicas=1, voice path works when you care |
| Comfy cold | gateway up; GPU `comfyui` still 0 until image/video |
| Downloads | `:30980` if you published installers |
| Lab CLI | `spockify lab` / `./scripts/spockify-lab-agents models` against `:30400` |

#### Smoke commands (copy/paste)

```bash
# Pods + intended scale
microk8s kubectl get pods,deploy -n spockify
microk8s kubectl get deploy -n spockify xtts comfyui comfyui-gateway \
  -o custom-columns=NAME:.metadata.name,READY:.status.readyReplicas,DESIRED:.spec.replicas

# OWUI
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30080/

# LiteLLM models (master key from secret — do not commit)
KEY=$(microk8s kubectl -n spockify get secret litellm-secrets \
  -o jsonpath='{.data.master.?key}' 2>/dev/null | base64 -d)
# if empty, check: microk8s kubectl -n spockify get secret -o name | grep -i litellm
curl -sS -H "Authorization: Bearer $KEY" http://127.0.0.1:30400/v1/models | head -c 400; echo

# Ollama
microk8s kubectl -n spockify exec deploy/ollama -- ollama list | head

# Dual-role + lab harness
./scripts/lab-set-dual-roles.sh
./scripts/spockify-lab-agents models
# or: SPOCKIFY_BASE_URL=http://lab-example.local:30400 spockify lab

# Downloads (if used)
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30980/
```

Secret key field names vary by install; if the jsonpath fails, `kubectl get secret … -o yaml` and pick the master-key data key.

---

## Common failures

| Symptom | Likely fix |
|---------|------------|
| SSH ok, kubectl hangs / not ready | Wait; `microk8s status --wait-ready` |
| `ensure-spark-boot` ERROR on Postgres | Do **not** invent a restore; check `/var/lib/spockify/postgres`; restore only with explicit backup tools |
| `DISABLE_SCHEMA_UPDATE` missing | Fix LiteLLM deploy before restarting it (Prisma push can wipe OWUI tables) |
| OWUI login / CLI activate links break | Re-run `lab-ensure-twin.sh` (`WEBUI_URL` + `OFFLINE_MODE` + cookie flags) |
| Lab agents / CLI can’t reach API | Point at `:30400` not `:30080` for `/v1`; re-run NodePort expose |
| Dual-role aliases missing | `./scripts/lab-set-dual-roles.sh` or full `lab-ensure-twin.sh` |
| `comfyui` unexpectedly at 1 | `lab-ensure-twin.sh` scales it back to 0 (gateway stays 1) |
| XTTS missing after hotfix | `ensure-spark-boot` / ensure twin re-scales xtts → 1 |
| nvidia-device-plugin CrashLoop | Often OK if Ollama still runs GPU via runtimeClass |
| First image/video slow or 503 | Comfy cold start; wait for gateway warm (up to ~600s) |
| Persistence CronJob flaps on 1 user | Twin uses `MIN_USERS=1` via ensure |

---

## Lab agents after boot (overnight tip)

Overnight harness work (2026-09-08 trails; best tip around **50** — exec stream early-stop / DONE digests) may still be **uncommitted** in the laptop/`agentHub` working tree. Reboot does not apply or discard that tip by itself.

After boot, if lab coding feels “old”:

1. Confirm twin/laptop checkout has the tip you want (`packages/spockify-lab-agents/`, see `snapshots/overnight-20260908/RESULTS.md`).
2. Re-run dual-role: `./scripts/lab-set-dual-roles.sh`
3. Smoke: `spockify lab` or `./scripts/spockify-lab-agents models`

Do not promote abliterated remaps as product defaults — twin-only via `lab-set-dual-roles.sh`.

---

## Quick reference

```bash
ssh lab@lab-example.local
cd ~/agentHub
microk8s status --wait-ready
SPOCKIFY_LAB_TWIN=1 make ensure-spark-boot
./scripts/lab-ensure-twin.sh
# then smoke commands above
```

LAN endpoints:

| Service | URL |
|---------|-----|
| Open WebUI | http://lab-example.local:30080 |
| LiteLLM `/v1` | http://lab-example.local:30400 |
| Router | http://lab-example.local:30100 |
| Downloads | http://lab-example.local:30980 |
