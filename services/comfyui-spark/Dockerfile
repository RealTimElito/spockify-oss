# Overlay on the existing Spark ComfyUI image.
# Adds Qwen-Image 2.1 (qwen_image21) from current ComfyUI and ComfyUI-GGUF.
# Does not start ComfyUI and does not load weights.
FROM localhost:32000/spockify-comfyui-spark:latest

ARG COMFYUI_REF=0df64eb242b7c5759c3e86afd5d1846d923b1033

COPY prepare.sh /tmp/prepare.sh
RUN chmod +x /tmp/prepare.sh && COMFYUI_REF="${COMFYUI_REF}" /tmp/prepare.sh

RUN git clone --depth 1 https://github.com/city96/ComfyUI-GGUF.git \
        /opt/ComfyUI/custom_nodes/ComfyUI-GGUF \
    && pip install --no-cache-dir -r /opt/ComfyUI/custom_nodes/ComfyUI-GGUF/requirements.txt

COPY zz_spockify_paths.py /opt/ComfyUI/custom_nodes/zz_spockify_paths.py

ENV COMFYUI_UNET_GGUF=1 \
    COMFYUI_QWEN_IMAGE21=1
