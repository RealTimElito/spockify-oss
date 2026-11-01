# G7 SBOM / SLSA (signed inventory, no provenance)

Inventory: `./docker/sbom.sh` writes CycloneDX 1.5 for the local npm packages
(`spockify-harness`, `spockify-cli`, `spockify-ide-client`). Image digest pins
are a separate path (`docker/record-image-digests.sh`).

This is a **signed SBOM**, not SLSA provenance. Do not claim a provenance
attestation.

## What exists

- CycloneDX JSON: `docker/sbom.cdx.json` (40 components at the 2026-10-17 stamp).
- Cosign sidecar: `docker/sbom.cdx.json.cosign.bundle`.
- Public key: `docker/sbom-cosign.pub`.
- Fail-closed signer: `docker/sign-sbom.sh` (exit 2 without a key).
- Verifier: `docker/verify-sbom.sh`.
- CI: `docker/test/sbom.test.sh` refuses unsigned fakes **and** verifies the
  committed bundle.

## Verify (anyone)

Needs the `cosign` binary (CI installs `v3.1.3`).

```bash
./docker/verify-sbom.sh docker/sbom.cdx.json
```

That checks the sidecar bundle against `docker/sbom-cosign.pub`. Verify is
offline (`--insecure-ignore-tlog`) so CI does not need Rekor. Signing used a
local cosign keypair; a Rekor hashedrekord may exist from the sign step. This
is still not SLSA provenance.

## Sign (maintainers)

Private key is **not** in git. Default location:

- `~/.cosign/spockify-sbom.key`
- passphrase file `~/.cosign/spockify-sbom.pass` (mode 600) or `COSIGN_PASSWORD`

```bash
./docker/sbom.sh docker/sbom.cdx.json
COSIGN_KEY_PATH="$HOME/.cosign/spockify-sbom.key" ./docker/sign-sbom.sh docker/sbom.cdx.json
./docker/verify-sbom.sh
```

Regenerate a project key only if none exists:

```bash
mkdir -p ~/.cosign && chmod 700 ~/.cosign
cosign generate-key-pair --output-key-prefix "$HOME/.cosign/spockify-sbom"
cp ~/.cosign/spockify-sbom.pub docker/sbom-cosign.pub
```

Never commit `*.key` or the passphrase.

## What does not exist

- No SLSA provenance (in-toto / GitHub generator / builder attestation).
- No disclosure / retention legal sign-off.

G7 signing is **green**. SLSA provenance stays **N/A** (documented; not a
missing checkbox we pretend to have). Legal leftover stays open. Signed
SBOM is the R2 bar.
