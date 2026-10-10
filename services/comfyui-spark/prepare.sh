#!/bin/bash
# Upgrade ComfyUI in-image. Keeps the existing CUDA torch and comfy-kitchen wheel.
set -euo pipefail

ref="${COMFYUI_REF:?}"
git -C /opt/ComfyUI fetch --depth 1 origin "${ref}"
git -C /opt/ComfyUI checkout --detach --force FETCH_HEAD

python - <<'PY'
from pathlib import Path

skip = {"torch", "torchvision", "comfy-kitchen", "comfy_kitchen"}
kept = []
for line in Path("/opt/ComfyUI/requirements.txt").read_text().splitlines():
    bare = line.strip()
    if not bare or bare.startswith("#"):
        continue
    name = bare.split("==")[0].split(">=")[0].split("[")[0].strip().lower()
    if name in skip:
        continue
    kept.append(bare)
Path("/tmp/req-keep.txt").write_text("\n".join(kept) + "\n")
PY

pip install --no-cache-dir -r /tmp/req-keep.txt

python - <<'PY'
from pathlib import Path

path = Path("/opt/ComfyUI/comfy/utils.py")
text = path.read_text()
old = "tensor = tensor.to(device=device, copy=True)"
new = "tensor = tensor.to(device=device, copy=False)"
if old in text:
    path.write_text(text.replace(old, new, 1))
PY
