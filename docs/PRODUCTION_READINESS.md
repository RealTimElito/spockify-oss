# Production-readiness gates (honest tracker)

Working plan: *Spockify Production Readiness Master Plan 2026* (v1.0, 14 Oct 2026).
This file is the execution checklist. A merged ticket is not a signed gate.
Phase 5 of the harness stays **Partial** until scored SWE on `@spockify/harness`
exists with instance IDs, model digest, harness SHA, evaluator result, and traces.
Do not publish SWE %, OpenCode, or Wichy scores from this document.

Release tiers: **R1** preview = G0–G4 with local-install smoke. **R2** single-tenant
production = G0–G8. **R4** shared SaaS is out of v1 scope.

## Go / No-Go (Table 22)

| Gate | Status | Why |
|------|--------|-----|
| G0 Code correctness | Partial | P0 reproducers exist (`p0-security.test.ts`) and harness CI runs kernel/CLI tests. Not an independent signed failure-suite. |
| G1 Policy & isolation | Operator-signed | Negative suite exists. G1-05/13/14 closed (bwrap seccomp, host isolation.env, ask-class SPAWN_CODING gated). G1-10 audit `reason` redacts secret-shaped values. G1-03 regex tightened (path-prefixed `rm`, `git push`/`reset`/`clean` ask). Residuals: G1-03 still a heuristic, G1-07 local job store. **G1-09 operator-waived by Tim 2026-10-17** (the operator; not a pentest, not an external human review). [`G1-SECURITY-REVIEW.md`](G1-SECURITY-REVIEW.md). |
| G2 Verified agent | Green | Live `gpt-oss-20b` `runHarness` card 3/3 Y on 2026-10-17 ([`G2-SCORECARD.md`](G2-SCORECARD.md), [`snapshots/harness-20b-card-20261017/CARD.md`](../snapshots/harness-20b-card-20261017/CARD.md)). Offline SCORECARD-10 10/10. No SWE %, no OpenCode/Wichy. Phase 5 Partial. |
| G3 Recovery | Partial | Interrupt/resume and corrupt-session tests exist. Not a full fault-injection drill pack. |
| G4 Model compatibility | Partial | Promoted vs lab-only deck + tests: [`G4-PROMOTED-MODELS.md`](G4-PROMOTED-MODELS.md). Auto is `spockify-auto`. No `:cloud` tags. `num_ctx` copied from Ollama/LiteLLM metadata (131072 gpt-oss / 262144 Qwen 3.8); not a GPU measurement. Auto default remains `gpt-oss-20b` think=off. |
| G5 Deployability | Partial | Compose production profile fail-closed (secrets, loopback, isolated runner, digest pins). Fresh GPU host smoke not recorded here. |
| G6 Operability | Partial | Restore script + throwaway drill exist. SLO defs + scrape path exist ([`G6-SLO.md`](G6-SLO.md)); window starts **2026-10-17**; `history_days_available=0` (complete days before today; one real JSONL sample on the operator host). Daily timer: `spockify-slo-scrape.timer` on the operator host (`/opt/spockify/slo/run.sh` → `/var/lib/spockify/slo`). Not a 30-day dashboard or signed RTO/RPO. |
| G7 Security & legal | Partial | Signed CycloneDX (40 components) verifies with `docker/verify-sbom.sh` + `docker/sbom-cosign.pub`. SLSA provenance **N/A**. No disclosure/retention legal sign-off. [`G7-SBOM.md`](G7-SBOM.md). |
| G8 Customer pilot | Red | Operator self-host rehearsal, no customer (`docker/pilot-rehearsal.sh`, [`G8-PILOT.md`](G8-PILOT.md)). Not Green. No named customer, no 30-day traffic. |

## R2 (2026-10-17) — SIGNED for operator production

This is **operator production** (Tim / single-tenant workstation), not enterprise and
not a customer launch. No SWE %, no OpenCode/Wichy scores, no SLSA provenance.

| Caveat | Fact |
|--------|------|
| G1-09 | Waived by Tim (operator) 2026-10-17. Not a pentest. Not an external human review. |
| Phase 5 | **Partial** (no scored SWE on `@spockify/harness` with IDs/digest/SHA/traces). |
| G8 | Operator self-host rehearsal only. No customer. Stays Red. |
| G6 SLO | Window start 2026-10-17. `history_days_available=0`. Daily scrape scheduled. |
| G7 SLSA | **N/A**. Signed CycloneDX SBOM is the bar. No legal sign-off. |
| G4 context | Derived `num_ctx` in catalog (Ollama 131072 / LiteLLM 262144). gpt-oss request option not injected. |
| Canary | `packs/canary-v1.json` calc `max_rounds=1`. Do not loosen. |

## P0 backlog (Table 11)

| ID | Status | Evidence |
|----|--------|----------|
| A-01 grant/revoke host-only | Done (tests) | `p0-security.test.ts` SEC-01 |
| A-02 broker shell/test | Done (tests) | `policy.ts` + SEC-02 |
| A-03 isolated job runner | Incremental | `isolate.ts` bwrap/podman fail-closed, no docker.sock, job admit/audit in `job.ts`. **Not** a multi-tenant control plane. No further A-03 work this increment. |
| A-04 canonical path/symlink | Done (tests) | `paths.ts` + scorecard path-symlink |
| A-05 stream rejection | Done (tests) | REL-01 in `p0-security.test.ts` / loop `finally` |
| A-06 SEARCH/REPLACE parser | Done (tests) | EDIT-01 + golden parse |
| A-07 serialize mutations | Done (tests) | EDIT-02 |
| A-08 verification-led terminal | Done (tests) | `disposition.ts` / REL-02 |
| A-09 Compose production defaults | Done (tests) | `docker/check-production-secrets.sh` + `docker/test/production-profile.test.sh` |
| A-10 CI kernel/security matrix | Partial | `.github/workflows/harness-ci.yml` (kernel, CLI, production profile, SBOM, SLO scrape, canary lock, rehearsal). IDE/model-adapter suites not required on every PR. |

## P1 leftovers that stay red without extra evidence

| ID | Status | Why it stays open |
|----|--------|-------------------|
| B-04 direct-kernel SWE | Red | mini-SWE wrapper still in the scored path; Phase 5 Partial |
| B-05 same-model OpenCode | Red | no frozen same-instance card |
| B-07 GPU admission | Red | not exercised; GPU occupied by pins; do not claim |
| B-09 timed restore | Partial | Throwaway synthetic restore passed locally (`restore_s: 1`, not a published SLO). |
| B-10 SBOM + pins | Partial | digest recorder + signed npm CycloneDX sidecar; SLSA provenance N/A; legal leftover |
| B-12 security assessment | Operator-waived | G1-09 waived by Tim 2026-10-17 (operator, not a pentest). Agent notes remain in-tree. |
| B-14 SLO / 30-day | Partial | defs + scrape exist; window start 2026-10-17; 0 complete days; daily timer installed (`/opt/spockify/slo`) |

## Isolation contract (R1/R2 workstation)

- Default workstation: host bash.
- Production profile: `SPOCKIFY_PRODUCTION=1` and `SPOCKIFY_ISOLATED_RUNNER=bwrap` or `podman`. Missing binary fails closed.
- Explicit `bwrap` or `podman` does not fall through to the other backend.
- Isolated spawns get a `job_id`, resource caps, no docker/podman socket, no SSH agent.
- Job store is local JSON under `$XDG_RUNTIME_DIR/spockify-jobs/<workspace>` (or `SPOCKIFY_JOB_DIR`), outside the workspace bind. Audit JSONL has no source, no secret-shaped keys, and redacts secret-shaped `reason` values (G1-10). Not multi-tenant (G1-07).

## Canary

`packs/canary-v1.json` calc `max_rounds` is **1**. Do not loosen. Canary red → revert, do not prompt-salvage.
