# Production-readiness gates (honest tracker)

Working plan: *Spockify Production Readiness Master Plan 2026* (v1.0, 14 Oct 2026).
This file is the execution checklist. A merged ticket is not a signed gate.
Phase 5 freeze evidence exists (2026-10-30): scored SWE on `@spockify/harness` for
`sqlfluff__sqlfluff-1625` with instance id, model digest, harness SHA/version,
evaluator result (**not-resolved**), and traces — see
[`snapshots/harness-swe-runHarness-20261030/CARD.md`](../snapshots/harness-swe-runHarness-20261030/CARD.md)
and [`snapshots/p1-roadmap-20261030/NOTES.md`](../snapshots/p1-roadmap-20261030/NOTES.md).
Phase 5 stays **Partial** (N=1 ≠ Lite board %; outcome not-resolved). Do not publish
SWE board %, OpenCode superiority, or Wichy scores from this document.

**Allowed public line** (SoT also in [`BENCHMARK_COMPARISON.md`](BENCHMARK_COMPARISON.md)):
*Default scored SWE driver is `@spockify/harness`; freeze instance sqlfluff-1625
not-resolved on gpt-oss-20b; same-model OpenCode empty_patch on that instance;
Lite board preds graded 70/300 completed-denominator (harness pred-regen×3 on 3
residuals).* Forbidden: “beats OpenCode,” enterprise, bare SWE %, invented %.

Release tiers: **R1** preview = G0–G4 with local-install smoke. **R2** single-tenant
production = G0–G8. **R4** shared SaaS is out of v1 scope.

## Go / No-Go (Table 22)

Honesty refresh **2026-11-04**: statuses below are unchanged from R2 unless noted.
Partial stays Partial — no greenwash. G8 stays Red (local pilot-rehearsal ok ≠ customer).
Scores cite SUMMARY SoT only (B-04 **27/27** closed · B-05 **6/27** · Lite **70/300**
Partial parked). Ops evidence pass stamped; no gate promoted.

| Gate | Status | Why |
|------|--------|-----|
| G0 Code correctness | Partial | P0 reproducers exist (`p0-security.test.ts`) and harness CI runs kernel/CLI tests. Not an independent signed failure-suite. No new signed suite this pass. |
| G1 Policy & isolation | Operator-signed | Negative suite exists. G1-05/13/14 closed (bwrap seccomp, host isolation.env, ask-class SPAWN_CODING gated). G1-10 audit `reason` redacts secret-shaped values. G1-03 regex tightened (path-prefixed `rm`, `git push`/`reset`/`clean` ask). Residuals: G1-03 still a heuristic, G1-07 local job store. **G1-09 operator-waived by Tim 2026-10-17** (the operator; not a pentest, not an external human review). [`G1-SECURITY-REVIEW.md`](G1-SECURITY-REVIEW.md). |
| G2 Verified agent | Green | Live `gpt-oss-20b` `runHarness` card 3/3 Y on 2026-10-17 ([`G2-SCORECARD.md`](G2-SCORECARD.md), [`snapshots/harness-20b-card-20261017/CARD.md`](../snapshots/harness-20b-card-20261017/CARD.md)). Offline SCORECARD-10 10/10. No SWE %, no OpenCode/Wichy. Phase 5 Partial. |
| G3 Recovery | Partial | Interrupt/resume and corrupt-session tests exist. Not a full fault-injection drill pack. No new drill pack this pass. |
| G4 Model compatibility | Partial | Promoted vs lab-only deck + tests: [`G4-PROMOTED-MODELS.md`](G4-PROMOTED-MODELS.md). Auto is `spockify-auto`. No `:cloud` tags. `num_ctx` copied from Ollama/LiteLLM metadata (131072 gpt-oss / 262144 Qwen 3.8); not a GPU measurement. Auto default remains `gpt-oss-20b` think=off. Deck still not a live GPU scorecard. |
| G5 Deployability | Partial | Compose production profile fail-closed (secrets, loopback, isolated runner, digest pins). Fresh GPU host smoke not recorded here. |
| G6 Operability | Partial | Restore script + throwaway drill exist. SLO defs + scrape path exist ([`G6-SLO.md`](G6-SLO.md)); window starts **2026-10-17**. Day-one stamp was `history_days_available=0`; this honesty pass did **not** verify a filled 30-day window or active operator timer. Not a 30-day dashboard or signed RTO/RPO. |
| G7 Security & legal | Partial | Signed CycloneDX (40 components) verifies with `docker/verify-sbom.sh` + `docker/sbom-cosign.pub` (signing sub-check green — see [`G7-SBOM.md`](G7-SBOM.md)). SLSA provenance **N/A**. No disclosure/retention legal sign-off. Gate stays Partial. |
| G8 Customer pilot | Red | Operator self-host rehearsal, no customer (`docker/pilot-rehearsal.sh`, [`G8-PILOT.md`](G8-PILOT.md)). Not Green. No named customer, no 30-day traffic. |

## R2 (2026-10-17) — SIGNED for operator production

This is **operator production** (Tim / single-tenant workstation), not enterprise and
not a customer launch. No SWE %, no OpenCode/Wichy scores, no SLSA provenance.

| Caveat | Fact |
|--------|------|
| G1-09 | Waived by Tim (operator) 2026-10-17. Not a pentest. Not an external human review. |
| Phase 5 | **Partial** (freeze card exists: IDs/digest/SHA/traces; N=1 not-resolved; not a board %). |
| G8 | Operator self-host rehearsal only. No customer. Stays Red. |
| G6 SLO | Window start 2026-10-17. Day-one `history_days_available=0`. 30-day dashboard not verified this pass. |
| G7 SLSA | **N/A**. Signed CycloneDX SBOM is the bar. No legal sign-off. Gate Partial. |
| G4 context | Derived `num_ctx` in catalog (Ollama 131072 / LiteLLM 262144). gpt-oss request option not injected. |
| Canary | `packs/canary-v1.json` calc `max_rounds=1`. Do not loosen. **Red policy:** canary red after a harness PR → revert the PR (do not prompt-salvage). Red catalog/pin → revert the pin only; keep spawn. Lock checked by `docker/test/canary-pack.test.sh` / CI. See [`HARNESS.md`](HARNESS.md#canary-pack). |

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
| B-04 direct-kernel SWE | Partial (board) | Unique **27/27 closed** (Partial evidence complete for that slice; post-slice resolves noted separately). Fail rows kept. sqlfluff fail kept. Lite mini-SWE **70/300** separate (completed denom clean after harness pred-regen×3; Hub auth still none; full-board parked). |
| B-05 same-model OpenCode | Advanced (open) | Match **6/27** on harness-resolved ids (same-model gpt-oss-20b). Not board-wide; not marketing %. Gap cells 12453/11039 filled; High grind idle/parked. |

## Ranked leftovers (post marketing honesty)

SoT: [`snapshots/p1-roadmap-20261030/SUMMARY.md`](../snapshots/p1-roadmap-20261030/SUMMARY.md). No Terminal Bench while P1 B-05 open. High empties **parked**. Hub auth skipped until Tim supplies Docker Hub creds.

1. ~~Lite pred-regen×3 + Accept Partial **70/300**~~ **done** — park full-board re-pred until a post-fix harness resolve justifies a multi-day run.
2. **Hub auth on Spock** — blocked until Tim supplies Docker Hub creds (before any future large regrade).
3. **B-05 Advanced** — only on **new** harness resolves; do not grind OpenCode on already-filled gaps. High parked → B-05 idle until a new resolve.
4. ~~**Marketing readiness**~~ **done (2026-11-03)** — Allowed public line only; G8 Red; no SWE board %, no “beats OpenCode,” no enterprise; Partial gates G0/G3–G7 restated without greenwash; canvas SoT **70/300**.
5. ~~**Harness quality** (sqlfluff / planning)~~ **steer shipped + smoke ran (2026-11-04)** — taxonomy [`TAXONOMY.md`](../snapshots/p1-roadmap-20261030/TAXONOMY.md); F2P-body-before-write + wrong-file `__init__` early stop in `run_harness_swe_one.py` (unit-tested). Deferred High smoke `matplotlib__matplotlib-25433` → **not-resolved** empty after continues (fail kept; no B-05). Next: proven gate bug only, or B-05 on a new harness resolve. Do not re-run sqlfluff / blind N / gold-prompt salvage / High empties. Ranked plan: [`snapshots/p1-roadmap-20261030/SUMMARY.md`](../snapshots/p1-roadmap-20261030/SUMMARY.md).
6. ~~**Partial gate evidence (ops)**~~ **done (2026-11-04)** — re-ran local checks; **did not promote any gate**. PHASE4-GREEN restored (IDE `agentLoop.ts` thin bridge ≤280 lines after moving Auto-pin helpers). Canary `calc` `max_rounds=1` locked. Signed SBOM verifies (40 components; signing sub-check green ≠ G7 Green). G8 `pilot-rehearsal.sh` green locally after fixing stale `slo.video.disabled` → `slo.video.enabled` assertion; **G8 stays Red** (no customer). G0/G3–G6 stay Partial (no new signed failure-suite / fault-injection pack / GPU scorecard / 30-day dashboard). Phase 5 stays Partial (N=1 not-resolved). **G1-09** remains operator-waived ≠ independent pentest. OSS Get Started path still compose/`docker/run.sh` (no Tim-only endpoints in public setup).
7. ~~**Canary red policy → SoT docs**~~ **done (2026-11-04)** — red-after-harness-PR → revert (no prompt-salvage); red catalog/pin → revert pin only; `max_rounds=1` lock already CI-gated. No gate promoted; scores unchanged.

**Next (Tim-blocked or score-parked):** Hub creds before any large Lite regrade; unpark High only on explicit ask; B-05 only after a new harness resolve; independent G1-09 pentest if Tim wants that bar.
