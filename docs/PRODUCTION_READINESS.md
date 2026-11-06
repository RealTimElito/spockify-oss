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
production = G0–G8. **R4** shared SaaS is out of v1 scope. Versioned profile notes
(Compose workstation vs production fail-closed): [`DEPLOY_PROFILES.md`](DEPLOY_PROFILES.md).

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
| G6 Operability | Partial | Restore script + throwaway drill exist. SLO defs + scrape path exist ([`G6-SLO.md`](G6-SLO.md)); window starts **2026-10-17**. Spock operator timer `spockify-slo-scrape.timer` **enabled 2026-11-06** (daily 16:00; first offline sample recorded; `history_days_available=0` until a full calendar day of files exists). Not a 30-day dashboard or signed RTO/RPO. |
| G7 Security & legal | Partial | Signed CycloneDX (40 components) verifies with `docker/verify-sbom.sh` + `docker/sbom-cosign.pub` (signing sub-check green — see [`G7-SBOM.md`](G7-SBOM.md)). Disclosure procedure doc: [`../SECURITY.md`](../SECURITY.md) (not legal sign-off). SLSA provenance **N/A**. No disclosure/retention legal sign-off. Gate stays Partial. |
| G8 Customer pilot | Red | Operator self-host rehearsal, no customer (`docker/pilot-rehearsal.sh`, [`G8-PILOT.md`](G8-PILOT.md)). Not Green. No named customer, no 30-day traffic. |

## R2 (2026-10-17) — SIGNED for operator production

This is **operator production** (Tim / single-tenant workstation), not enterprise and
not a customer launch. No SWE %, no OpenCode/Wichy scores, no SLSA provenance.

| Caveat | Fact |
|--------|------|
| G1-09 | Waived by Tim (operator) 2026-10-17. Not a pentest. Not an external human review. |
| Phase 5 | **Partial** (freeze card exists: IDs/digest/SHA/traces; N=1 not-resolved; not a board %). |
| G8 | Operator self-host rehearsal only. No customer. Stays Red. |
| G6 SLO | Window start 2026-10-17. Timer armed on Spock 2026-11-06; `history_days_available=0` until complete calendar days accumulate. 30-day dashboard not verified. |
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

## Ranked leftovers (easy → hard)

SoT: [`snapshots/p1-roadmap-20261030/SUMMARY.md`](../snapshots/p1-roadmap-20261030/SUMMARY.md). Prefer easy local/doc/ops wins before Tim-gated freezes. No Terminal Bench while P1 B-05 open. High empties **parked**. Hub auth skipped until Tim supplies Docker Hub creds.

### Easy (local / docs / ops) — prefer first
1. ~~Lite pred-regen×3 + Accept Partial **70/300**~~ **done**
2. ~~**Marketing readiness**~~ **done (2026-11-03)**
3. ~~**Harness quality** (sqlfluff / planning)~~ **steer + smoke done (2026-11-04)** — no sqlfluff/N/High empties without new hypothesis.
4. ~~**Partial gate evidence (ops)**~~ **done (2026-11-04)** — PHASE4-GREEN / canary / SBOM / G8 rehearsal; gates stay Partial; G8 Red.
5. ~~**Canary red policy → SoT docs**~~ **done (2026-11-04)**
6. ~~**Easy re-verify + G6 timer (2026-11-06)**~~ **done** — PHASE4-GREEN, canary, SBOM, restore-drill synthetic, pilot-rehearsal local ok; canvas Lite **70/300**; Spock `spockify-slo-scrape.timer` enabled + first sample. **G6 stays Partial** (`history_days_available=0`). No gate promoted.
7. ~~**Strategic Roadmap easy non-P1 (2026-11-06)**~~ **done** — `SECURITY.md` disclosure procedure; scrubbed public `/roadmap`; `docs/AI_GIT_ATTRIBUTION.md` + `appendAiCoAuthorTrailer`. **G7 stays Partial** (no legal sign-off / audit). ide-site reload is `kubectl apply -k k8s/ide-site` (operator step if not applied this pass).
8. ~~**Strategic Roadmap easy trail batch 2 (2026-11-06)**~~ **done** — §8 git history analysis skill (`packages/spockify-cli/skills/git-history-analysis/SKILL.md`); §6 example packs as docs templates (`docs/example-packs/`); §7 versioned deploy-profile docs (`docs/DEPLOY_PROFILES.md`). Docs/skills only — no deploy rebuild, no forge API, no marketplace/SDK, no Hub/High/SWE/Terminal Bench. No new public page (ide-site apply N/A).
9. ~~**Strategic Roadmap easy trail batch 3 (2026-11-06)**~~ **done** — §8 intelligent-commits skill + release-notes-from-tags skill/docs (`packages/spockify-cli/skills/intelligent-commits/`, `packages/spockify-cli/skills/release-notes-from-tags/`, `docs/RELEASE_NOTES_FROM_TAGS.md`); §7 Dependabot stub (`.github/dependabot.yml` for Actions + core npm dirs). No trivy workflow (SBOM already in harness-ci; image trivy deferred). Docs/skills/CI stub only — no Hub/High/SWE/Terminal Bench/pentest, no Win/mac signing. No new public page (ide-site apply N/A). **Doc/skill easy trail for named §8/§7 stubs is clear**; remaining §8 essentials (branch/PR/review) need forge or deeper agent loops — not more one-file skills.

### Harder (Tim-gated or score-parked) — after easy
10. **Hub auth on Spock** — Docker Hub creds before any large Lite regrade.
11. **B-05 Advanced** — only on **new** harness resolves; High parked → idle until resolve or explicit High unpark.
12. **Independent G1-09 pentest** — optional; operator waiver ≠ pentest.
13. Promoting G0/G3–G5/G7 beyond Partial — needs signed failure-suite / fault-injection pack / GPU scorecard / legal sign-off (not local re-checks).

**Next:** harder Tim-gated queue (Hub, High unpark, B-05 on new resolve, optional G1-09). Named easy doc/skill §8/§7 stubs are empty; leftover Strategic surface (forge PR/review, marketplace/SDK, enterprise RBAC) is hard. No Terminal Bench / greenwash while P1 gates open.
