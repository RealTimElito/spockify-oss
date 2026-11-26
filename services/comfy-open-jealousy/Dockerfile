# Open Jealousy custom nodes on the existing Spark Comfy image.
# Weights stay on the Comfy PVC (loras/_oj). This image only adds code.
ARG BASE=localhost:32000/spockify-comfyui-spark:kitchen-0.2.37
FROM ${BASE}

COPY zz_open_jealousy_paths.py /opt/ComfyUI/custom_nodes/zz_open_jealousy_paths.py

RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus.git \
        /opt/ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus || true
RUN git clone --depth 1 https://github.com/cubiq/ComfyUI_InstantID.git \
        /opt/ComfyUI/custom_nodes/ComfyUI_InstantID || true
RUN git clone --depth 1 https://github.com/cubiq/PuLID_ComfyUI.git \
        /opt/ComfyUI/custom_nodes/PuLID_ComfyUI || true
RUN git clone --depth 1 https://github.com/Fannovel16/comfyui_controlnet_aux.git \
        /opt/ComfyUI/custom_nodes/comfyui_controlnet_aux || true
RUN pip install --no-cache-dir insightface onnxruntime opencv-python-headless || true
# controlnet_aux upstream requirements.txt installs an unpinned torch.
# Keep the base image torch. Preprocessors stay optional.
RUN if [ -d /opt/ComfyUI/custom_nodes/comfyui_controlnet_aux ]; then \
      printf '%s\n' '# torch stays the base image pin' \
        > /opt/ComfyUI/custom_nodes/comfyui_controlnet_aux/requirements.txt; \
    fi
RUN pip install --no-cache-dir ftfy timm facexlib || true

# LatentSync runner (weights on PVC: loras/_oj/latentsync). Prefer Dockerfile.latentsync
# for hotfix layers on open-jealousy-2. Do not upgrade torch; skip decord on aarch64.
COPY patch_latentsync_aarch64.py /tmp/patch_latentsync_aarch64.py
RUN git clone --depth 1 https://github.com/bytedance/LatentSync.git /opt/LatentSync \
    && pip install --no-cache-dir \
        "diffusers==0.32.2" \
        "transformers==4.48.0" \
        "accelerate==0.26.1" \
        "einops==0.7.0" \
        "omegaconf==2.3.0" \
        "python_speech_features==0.6" \
        "librosa==0.10.1" \
        "soundfile==0.12.1" \
        "ffmpeg-python==0.2.0" \
        "imageio==2.31.1" \
        "imageio-ffmpeg==0.5.1" \
        "face-alignment==1.4.1" \
        "kornia==0.8.0" \
        "packaging" \
        "tqdm" \
    && python3 /tmp/patch_latentsync_aarch64.py \
    && rm -f /tmp/patch_latentsync_aarch64.py
ENV SPOCKIFY_LATENTSYNC_PY=/opt/LatentSync/scripts/inference.py
ENV SPOCKIFY_LATENTSYNC_VAE=/opt/ComfyUI/models/loras/_oj/latentsync/sd-vae-ft-mse
