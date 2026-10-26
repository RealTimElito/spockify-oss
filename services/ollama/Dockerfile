# Ollama with Linux CUDA image-generation deps (MLX runner).
# Upstream docker image is missing libquadmath0 and CUDA 13 headers required for
# /v1/images/generations (x/z-image-turbo, x/flux2-klein). See ollama/ollama#14016.
FROM ollama/ollama:latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends libquadmath0 wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CUDA_LIBS=" \
cuda-toolkit-config-common_13.0.48-1_all.deb \
cuda-toolkit-13-config-common_13.0.48-1_all.deb \
cuda-toolkit-13-0-config-common_13.0.48-1_all.deb \
cuda-cudart-13-0_13.0.48-1_amd64.deb \
cuda-cccl-13-0_13.0.50-1_amd64.deb \
cuda-culibos-dev-13-0_13.0.39-1_amd64.deb \
cuda-driver-dev-13-0_13.0.48-1_amd64.deb \
cuda-cudart-dev-13-0_13.0.48-1_amd64.deb \
cuda-nvrtc-13-0_13.0.48-1_amd64.deb \
"

RUN for i in $CUDA_LIBS; do \
      wget -q "https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/$i"; \
    done \
    && dpkg -i $CUDA_LIBS \
    && rm -f $CUDA_LIBS

RUN cd /usr/local/cuda-13.0/targets/x86_64-linux \
    && ln -sf cccl/cuda include/cuda \
    && ln -sf /usr/local/cuda-13.0/targets/x86_64-linux/include /usr/lib/ollama/mlx_cuda_v13/include

# Ensure MLX shared libs resolve when the image runner subprocess starts.
RUN cd /usr/lib/ollama \
    && ln -sf mlx_cuda_v13/libmlxc.so libmlxc.so \
    && ln -sf mlx_cuda_v13/libmlx.so libmlx.so

ENV LD_LIBRARY_PATH=/usr/lib/ollama:/usr/lib/ollama/mlx_cuda_v13:/usr/lib/ollama/cuda_v13
