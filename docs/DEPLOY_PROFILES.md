# Versioned deploy profiles (docs)

Clarifies the **already-in-tree** release tiers and Compose profiles. This page
does **not** rebuild or redeploy anything.

SoT gate tracker: [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).
Operator steps: [`RUNBOOKS.md`](RUNBOOKS.md). Compose entry: [`../docker/README.md`](../docker/README.md).

## Release tiers (versioned intent)

| Profile | Meaning in this tree | What “signed” means |
|---------|----------------------|---------------------|
| **R1 — preview** | Gates **G0–G4** with a local-install smoke | Developer / preview self-host; not operator production |
| **R2 — single-tenant operator production** | Gates **G0–G8** as tracked in PRODUCTION_READINESS | Tim / single-tenant workstation or dedicated compose host. **Not** shared SaaS, **not** enterprise multi-tenant |
| **R4 — shared SaaS** | Out of v1 scope | Do not claim |

R2 was stamped **2026-10-17** for operator production with explicit caveats
(G1-09 operator waiver ≠ pentest, G8 Red, Phase 5 Partial, G7 Partial / SLSA N/A).
Statuses stay honest Partial/Red until new evidence lands — see the readiness table.

## Compose runtime profiles (env, not a separate compose file)

There is no marketplace of deploy packs. Compose uses env flags on
`./docker/run.sh` / `make up`:

| Runtime profile | How to select | Behaviour |
|-----------------|---------------|-----------|
| **Workstation (default)** | Unset `SPOCKIFY_PRODUCTION` / `SPOCKIFY_PROFILE` | Placeholders allowed for local smoke; coding shells may stay on host bash; `:latest` pulls OK for workstation |
| **Production** | `SPOCKIFY_PRODUCTION=1` **or** `SPOCKIFY_PROFILE=production` | Fail-closed via [`../docker/check-production-secrets.sh`](../docker/check-production-secrets.sh) |

### Production profile requirements (already enforced)

When production is requested, `docker/run.sh` runs the secret check before up:

- Real secrets (not documented placeholders); `WEBUI_SECRET_KEY` ≥ 32 chars
- `ENABLE_SIGNUP=false`
- Loopback binds: `SPOCKIFY_API_BIND` / `SPOCKIFY_ROUTER_BIND` ∈ `{127.0.0.1,localhost,::1}`
- `SPOCKIFY_ISOLATED_RUNNER=bwrap` or `podman` (missing / `none` is a hard error)
- Image refs: no unpinned `:latest`; router/Open WebUI must be `image@sha256:…` or tree `:local`
- Writes `$XDG_CONFIG_HOME/spockify/isolation.env` (or `SPOCKIFY_HOST_ISOLATION_ENV`) so host CLI/IDE inherit isolation flags

Record digests with `./docker/record-image-digests.sh`. Verify the check without
bringing a stack up: `./docker/test/production-profile.test.sh`.

### Related artefacts (unchanged by this doc)

| Artefact | Role |
|----------|------|
| `./docker/pilot-rehearsal.sh` | Local operator rehearsal (G8 stays Red without a customer) |
| `./docker/restore-drill.sh` | Throwaway restore drill — not live cluster postgres |
| `./docker/sbom.sh` + `verify-sbom.sh` | Signed CycloneDX bar (not SLSA provenance) |
| [`HARNESS.md`](HARNESS.md) | Isolated runner semantics under production |

## What this is not

- A new Kubernetes overlay or `make deploy` path
- Multi-tenant / RBAC / SSO (Priority 4 enterprise work)
- A greenwash of Partial gates — documenting profiles does not promote G5/G6/G7/G8
