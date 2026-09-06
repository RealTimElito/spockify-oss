#!/bin/bash
# Extract Spockify IDE AppImage into /opt/spockify-ide (no FUSE).
# Invoked from Dockerfile via `bash extract-appimage.sh` so Podman/buildah
# does not need SHELL=["/bin/bash","-c"] (often ignored).
set -euo pipefail

LOCAL=""
for f in /tmp/payload/*.AppImage; do
  if [[ -f "${f}" ]]; then LOCAL="${f}"; break; fi
done

if [[ -n "${LOCAL}" ]]; then
  echo "Using local AppImage ${LOCAL}"
  cp "${LOCAL}" /tmp/Spockify-IDE.AppImage
else
  URL="${APPIMAGE_URL:-}"
  if [[ -z "${URL}" ]]; then
    if [[ "${TARGETARCH:-}" == "arm64" ]]; then
      URL="https://spockify.eu/downloads/Spockify-IDE-0.9.16-aarch64.AppImage"
    else
      URL="https://spockify.eu/downloads/Spockify-IDE-0.9.16-x86_64.AppImage"
    fi
  fi
  echo "Fetching ${URL}"
  curl -fL --connect-timeout 20 --retry 3 -o /tmp/Spockify-IDE.AppImage "${URL}"
fi

chmod +x /tmp/Spockify-IDE.AppImage
cd /tmp && ./Spockify-IDE.AppImage --appimage-extract
mkdir -p /opt
mv /tmp/squashfs-root /opt/spockify-ide
chmod u-s,g-s /opt/spockify-ide/usr/share/spockify-ide/chrome-sandbox 2>/dev/null || true
# rootless Podman (--userns=keep-id) must read app files (product.json is often 0600).
chmod -R a+rX /opt/spockify-ide
rm -f /tmp/Spockify-IDE.AppImage
rm -rf /tmp/payload
test -x /opt/spockify-ide/AppRun
