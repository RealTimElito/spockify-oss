# open-remote-ssh vendor record

| Field | Value |
|-------|--------|
| Upstream URL | `https://github.com/jeanp413/open-remote-ssh.git` |
| Pinned ref | `v0.2.0` |
| Pinned commit SHA | `425a7b5530bf05461c208d259537dc8fb25b8e62` |
| Upstream version | `0.2.0` (see `upstream/package.json`) |
| Vendored on | 2026-07-19 |
| Location | `extensions/spockify-remote-ssh/upstream/` (gitignored; re-fetch via script) |
| License | `upstream/LICENSE.txt` (present after vendor) |
| Spockify changes | REH defaults in `apps/spockify-ide/product/product.json.stub` + `wire-remote-ssh.sh` → Spockify-hosted REH on spockify.eu (not VSCodium GitHub) |

## Re-fetch

```bash
./extensions/spockify-remote-ssh/scripts/vendor-upstream.sh --ref v0.2.0
```

## Wire into code-oss

```bash
./apps/spockify-ide/scripts/apply-product-overlay.sh
./apps/spockify-ide/scripts/wire-remote-ssh.sh
```

`wire-remote-ssh.sh` builds `lib/extension.js`, sets Spockify REH `package.json` defaults, and symlinks
`apps/spockify-ide/vendor/code-oss/extensions/open-remote-ssh` → this `upstream/`.

Install uses `npm install --ignore-scripts` because npm 11 on Linux fails silently when
preparing the `jeanp413/ssh2` git dependency (exit 1 with only the trailing debug-log line).
The wire script then builds `simple-socks` `dist/` separately (required by webpack).

## Layout

```text
extensions/spockify-remote-ssh/
  README.md
  VENDOR.md
  scripts/vendor-upstream.sh
  upstream/          # open-remote-ssh @ v0.2.0 (gitignored)
```

See `apps/spockify-ide/docs/REMOTE_SSH.md` and `apps/spockify-ide/PATCHES.md`.
