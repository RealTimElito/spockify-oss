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

# This ComfyUI checkout calls comfy_kitchen.adaln (FLUX) and
# int8_attention_is_available (import). The base image pins 0.2.7, which
# has neither. Keep torch; only replace the kitchen wheel.
pip install --no-cache-dir --no-deps "comfy-kitchen==0.2.37"

python - <<'PY'
from pathlib import Path

path = Path("/opt/ComfyUI/comfy/utils.py")
text = path.read_text()
old = "tensor = tensor.to(device=device, copy=True)"
new = "tensor = tensor.to(device=device, copy=False)"
if old in text:
    path.write_text(text.replace(old, new, 1))
PY

# comfy_kitchen 0.1.0 (kept for the CUDA wheel) has no int8_attention_is_available.
# Newer ComfyUI calls it at import and the process exits before it listens.
python - <<'PY'
from pathlib import Path

path = Path("/opt/ComfyUI/comfy/ldm/modules/attention.py")
text = path.read_text()
old = "COMFY_KITCHEN_INT8_ATTENTION_IS_AVAILABLE = comfy_kitchen.int8_attention_is_available()"
new = (
    "COMFY_KITCHEN_INT8_ATTENTION_IS_AVAILABLE = bool("
    "getattr(comfy_kitchen, 'int8_attention_is_available', lambda *_a, **_k: False)()"
    ")"
)
if old in text:
    path.write_text(text.replace(old, new, 1))
PY
