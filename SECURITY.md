# Security

Spockify is a self-hosted coding stack. This note is the **documented security response** for the public project. It is not a legal sign-off, an SLA, or evidence of an independent security audit.

## Reporting a vulnerability

Prefer a **private vulnerability report** on the public `spockify-oss` GitHub
repository (Security → Advisories → New draft security advisory), so details
are not posted in a public issue before a fix lands.

If private advisories are unavailable, open a normal issue titled
`[SECURITY]` and avoid including exploit payloads, credentials, or private
host details in the first message.

Please include:

- Affected component (Compose, CLI, harness, IDE extension, router, etc.)
- Version, tag, or commit if known
- Steps to reproduce (minimal)
- Impact you observe (what an attacker could do)

We aim to acknowledge reports and keep reporters informed. There is **no
guaranteed response time** and **no bug-bounty program**.

## What we already publish

- Signed CycloneDX SBOM for local npm packages — see [`docs/G7-SBOM.md`](docs/G7-SBOM.md)
  and `./docker/verify-sbom.sh`.
- Isolation / policy notes for the coding harness — see
  [`docs/G1-SECURITY-REVIEW.md`](docs/G1-SECURITY-REVIEW.md) and
  [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).

## What we do not claim

- **G7 Security & legal** remains **Partial** until legal retention/disclosure
  sign-off (and other gate criteria) are closed. This file does not green that gate.
- No SLSA provenance attestation.
- No independent pentest or third-party audit is implied by this document.
- Operator self-reviews and waivers are not substitutes for independent review.

## Scope notes for self-host operators

You run the stack on infrastructure you control. Harden Compose/production
profiles, secrets, network exposure, and model/tool policy for your deployment.
Public marketing pages and this repo do not replace your own threat model.
