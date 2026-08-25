# Spockify Remote SSH (OSS)

**WS-A owned.** Vendored / pinned packaging of [jeanp413/open-remote-ssh](https://github.com/jeanp413/open-remote-ssh) for Spockify IDE.

## Why this exists

Microsoft Remote - SSH (`ms-vscode-remote.remote-ssh`) is **proprietary** and must not ship in redistributable Spockify IDE builds. open-remote-ssh is the OSS path used by VSCodium and other code-oss forks.

## Status (M0)

| Item | State |
|------|--------|
| Stub + pin docs | Done |
| Upstream source tree | Done — `upstream/` @ `v0.2.0` (`425a7b55…`, gitignored) |
| Built-in to code-oss | Done — `./apps/spockify-ide/scripts/wire-remote-ssh.sh` (symlink + webpack + REH defaults) |

Spike AC: [`apps/spockify-ide/docs/REMOTE_SSH.md`](../../apps/spockify-ide/docs/REMOTE_SSH.md).

## Pin

| Field | Value |
|-------|--------|
| Upstream | `https://github.com/jeanp413/open-remote-ssh.git` |
| Recommended pin | tag / commit of **0.2.0** (or newer release at vendor time) — record exact SHA in `VENDOR.md` when copied |
| Extension id (upstream) | `jeanp413.open-remote-ssh` |
| Extension id (after Spockify rename, optional) | `spockify.spockify-remote-ssh` |

## How to vendor

```bash
./extensions/spockify-remote-ssh/scripts/vendor-upstream.sh
# or shallow clone manually into extensions/spockify-remote-ssh/upstream/
```

Preferred packaging options (pick one when integrating):

1. **Git subtree / copy** of upstream into this directory (pin SHA in `VENDOR.md`).
2. **Built-in extension path** from code-oss pointing at this folder.
3. **vsix** built from pinned upstream and listed in product `builtInExtensions`.

Do **not** download Microsoft Remote-SSH vsix.

## Default settings for code-oss

See REMOTE_SSH.md. Product overlay hint lives in `apps/spockify-ide/product/product.json.stub`.

## Parallel-safe

- Own: this directory + REMOTE_SSH.md coordination with shell
- Do not edit: `extensions/spockify/**`, packages AI client, OWUI, router
