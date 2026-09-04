# Spockify IDE in a container (Fedora / SELinux)

This is the path for **running the desktop IDE on Fedora** (and other SELinux
hosts) without FUSE or a host AppImage. The container is Debian; the host only
needs Docker or Podman and a graphical session.

It is **not** a guarantee that Electron+GPU+Wayland works on every box.

## Why a container

| Host AppImage | In this container |
|---------------|-------------------|
| Needs FUSE (`libfuse2`) | Extracted at image build (`--appimage-extract`) |
| SELinux often blocks the squashfs mount | Data bind uses `:z`; display sockets use `label=disable` |
| Chromium SUID sandbox FATAL | AppRun already passes `--no-sandbox` |
| Fedora `.deb` is the wrong package format | Debian image installs the runtime libs |

## Run (Fedora or Ubuntu, graphical session)

```bash
./docker/ide/run.sh --build
# later:
./docker/ide/run.sh
```

`--build` downloads the published AppImage (or uses `docker/ide/payload/*.AppImage`
if you drop one in). `run.sh` picks Docker vs Podman, X11 vs Wayland, and
`--userns=keep-id` on Podman.

Open a repo: `SPOCKIFY_WORKSPACE=~/src/myapp ./docker/ide/run.sh`

For Tab completions against the compose stack, set IDE
`spockify.baseUrl` to `http://localhost:3080` (after `./docker/run.sh`).
The compose stack pulls **Codestral** for Ghost FIM.

## Distrobox (often better on Fedora GNOME)

Raw Docker GUI pass-through is fiddly. Distrobox is the usual Fedora way to run
a Debian/Ubuntu userland with your Wayland session:

```bash
sudo dnf install distrobox podman
distrobox create --name spockify-ide --image ubuntu:24.04
distrobox enter spockify-ide
# inside:
curl -fLO https://spockify.eu/downloads/Spockify-IDE_0.9.15_amd64.deb
sudo apt update && sudo apt install -y ./Spockify-IDE_0.9.15_amd64.deb
spockify-ide
```

Export a host menu entry with `distrobox-export --app spockify-ide` if you want.

## What this does *not* cover

- **We have not run this on a Fedora workstation in this change.** Expect to
  tweak `xhost`, `--security-opt label=disable`, or Wayland env on the first box.
- **macOS / Windows** — use the native zip; this image is Linux GUI only.
- **SSH into the container as a Remote SSH target** — possible if you add
  `openssh-server`, not wired here. Using Remote SSH *from* the IDE to another
  machine needs `~/.ssh` mounted (pass extra `-v` if you need that).
- **aarch64** image must be built on arm64 (or buildx) so it pulls the
  `*-aarch64.AppImage`. An amd64 image will not run on aarch64 Fedora.
- **Headless / SSH-only hosts** — no display, no IDE. Use web chat compose
  (`docker/README.md`) instead.
- **“All Linux distros”** — the engine must be Docker or Podman. Immutable
  Fedora variants (Silverblue) should use Podman + Distrobox, not Docker CE.

## Build args

| Arg | Meaning |
|-----|---------|
| `APPIMAGE_URL` | Override download (default: 0.9.15 AppImage for `TARGETARCH`) |
| local file | `cp Spockify-IDE-*.AppImage docker/ide/payload/` then `--build` |
