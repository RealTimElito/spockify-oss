"""Point GGUF UNet and VAE loaders at the mounted checkpoints directory.

The Spark pod mounts only models/checkpoints and models/text_encoders.
ComfyUI-GGUF looks up UnetLoaderGGUF files under diffusion_models/unet,
then opens them with folder_paths.get_full_path("unet", ...). VAELoader
looks under models/vae. This node loads after ComfyUI-GGUF (zz_ prefix)
and adds the checkpoints mount to those search lists.
"""

from __future__ import annotations

import torch

import comfy.model_management
import folder_paths


def _add(folder_name: str, path: str) -> None:
    paths, exts = folder_paths.folder_names_and_paths.get(folder_name, ([], set()))
    if path not in paths:
        paths.append(path)
    folder_paths.folder_names_and_paths[folder_name] = (paths, exts)


ckpt_dirs = list(folder_paths.get_folder_paths("checkpoints"))
for ckpt_dir in ckpt_dirs:
    _add("diffusion_models", ckpt_dir)
    _add("unet", ckpt_dir)
    _add("vae", ckpt_dir)
    if "unet_gguf" in folder_paths.folder_names_and_paths:
        _add("unet_gguf", ckpt_dir)


class EmptyQwenImage21Latent:
    """64-channel latent, spatial scale 16. Stock EmptyLatentImage is 4-channel."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 16}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 16}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4}),
            }
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "make"
    CATEGORY = "latent"

    def make(self, width, height, batch_size):
        width = max(16, int(width) // 16 * 16)
        height = max(16, int(height) // 16 * 16)
        samples = torch.zeros(
            [batch_size, 64, height // 16, width // 16],
            device=comfy.model_management.intermediate_device(),
        )
        return ({"samples": samples},)


NODE_CLASS_MAPPINGS = {"EmptyQwenImage21Latent": EmptyQwenImage21Latent}
NODE_DISPLAY_NAME_MAPPINGS = {
    "EmptyQwenImage21Latent": "Empty Qwen-Image 2.1 Latent",
}
