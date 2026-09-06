# Spockify IDE — Linux GUI in a container (Fedora/SELinux-friendly).
#
# Host can be Fedora, Ubuntu, or anything with Docker/Podman + a display.
# The AppImage is extracted at *build* time (no FUSE on the host).
#
#   docker build -t spockify-ide:local -f docker/ide/Dockerfile docker/ide
#   ./docker/ide/run.sh
#
# Or pass a local AppImage:
#   cp Spockify-IDE-*-x86_64.AppImage docker/ide/payload/
#   docker build -t spockify-ide:local -f docker/ide/Dockerfile docker/ide

FROM debian:bookworm-slim

ARG TARGETARCH
ARG APPIMAGE_URL=
ARG DEBIAN_FRONTEND=noninteractive

SHELL ["/bin/bash", "-c"]

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 \
    libxshmfence1 libdrm2 libx11-xcb1 libxcb-dri3-0 \
    libxkbfile1 libsecret-1-0 libnotify4 libxrandr2 \
    libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
    libcups2 libpango-1.0-0 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxi6 libxtst6 \
    fonts-dejavu-core fonts-liberation \
    xdg-utils \
    mesa-vulkan-drivers libgl1-mesa-dri \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/payload
COPY payload/ /tmp/payload/

# Prefer a baked-in AppImage; otherwise download the published one.
# --appimage-extract does not need FUSE (unlike running the AppImage).
RUN set -euo pipefail; \
    LOCAL=""; \
    for f in /tmp/payload/*.AppImage; do \
      if [[ -f "${f}" ]]; then LOCAL="${f}"; break; fi; \
    done; \
    if [[ -n "${LOCAL}" ]]; then \
      cp "${LOCAL}" /tmp/Spockify-IDE.AppImage; \
    else \
      URL="${APPIMAGE_URL}"; \
      if [[ -z "${URL}" ]]; then \
        if [[ "${TARGETARCH}" == "arm64" ]]; then \
          URL="https://spockify.eu/downloads/Spockify-IDE-0.9.15-aarch64.AppImage"; \
        else \
          URL="https://spockify.eu/downloads/Spockify-IDE-0.9.15-x86_64.AppImage"; \
        fi; \
      fi; \
      echo "Fetching ${URL}"; \
      curl -fL --connect-timeout 20 --retry 3 -o /tmp/Spockify-IDE.AppImage "${URL}"; \
    fi; \
    chmod +x /tmp/Spockify-IDE.AppImage; \
    cd /tmp && ./Spockify-IDE.AppImage --appimage-extract; \
    mkdir -p /opt; \
    mv /tmp/squashfs-root /opt/spockify-ide; \
    chmod u-s,g-s /opt/spockify-ide/usr/share/spockify-ide/chrome-sandbox 2>/dev/null || true; \
    rm -f /tmp/Spockify-IDE.AppImage; \
    rm -rf /tmp/payload; \
    test -x /opt/spockify-ide/AppRun

# Arbitrary host UIDs (rootless Podman / --user) can write config + workspace.
RUN mkdir -p /home/spockify /workspace \
    && chmod 1777 /home/spockify /workspace

ENV HOME=/home/spockify \
    ELECTRON_OZONE_PLATFORM_HINT=auto \
    ELECTRON_FORCE_IS_PACKAGED=1

COPY entrypoint.sh /usr/local/bin/spockify-ide-entry
RUN chmod +x /usr/local/bin/spockify-ide-entry

VOLUME ["/home/spockify", "/workspace"]
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/spockify-ide-entry"]
