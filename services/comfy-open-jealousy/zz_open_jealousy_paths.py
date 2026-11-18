"""Open Jealousy paths and lip/talk nodes.

Adds Comfy search paths for weights stored under the mounted loras/_oj tree
(controlnet, ipadapter, instantid, pulid, insightface) and writes a cold
manifest the router can read without calling /object_info.

SpockifyLatentSync / SpockifyTalkingHead run only when a local runner and
weights are present. Import of this file must not break Comfy startup.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import folder_paths

OJ = Path("/opt/ComfyUI/models/loras/_oj")
LATENTSYNC_SCRIPT = Path(
    os.environ.get("SPOCKIFY_LATENTSYNC_PY", "/opt/LatentSync/scripts/inference.py")
)
LIVEPORTRAIT_SCRIPT = Path(
    os.environ.get("SPOCKIFY_LIVEPORTRAIT_PY", "/opt/LivePortrait/inference.py")
)


def _add(folder_name: str, path: Path) -> None:
    if not path.is_dir():
        return
    paths, exts = folder_paths.folder_names_and_paths.get(folder_name, ([], {".safetensors", ".ckpt", ".pt", ".bin", ".pth"}))
    text = str(path)
    if text not in paths:
        paths.append(text)
    folder_paths.folder_names_and_paths[folder_name] = (paths, exts)


def _link_insightface() -> None:
    src = OJ / "insightface"
    if not src.is_dir():
        return
    dest = Path("/opt/ComfyUI/models/insightface")
    try:
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            link = dest / child.name
            if link.exists() or link.is_symlink():
                continue
            link.symlink_to(child, target_is_directory=child.is_dir())
    except OSError:
        return


def _link_clip_vision() -> None:
    """Expose OJ clip_vision weights to the default Comfy clip_vision folder.

    The Spark deploy does not mount models/clip_vision from the PVC, so Wan
    FLF's CLIPVisionLoader only sees the image's empty placeholder unless we
    symlink from the mounted loras/_oj/clip_vision tree.
    """
    src = OJ / "clip_vision"
    if not src.is_dir():
        return
    dest = Path("/opt/ComfyUI/models/clip_vision")
    try:
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            if not child.is_file():
                continue
            link = dest / child.name
            if link.exists() or link.is_symlink():
                continue
            link.symlink_to(child)
    except OSError:
        return


def _has_weights(folder: Path, suffixes: tuple[str, ...]) -> bool:
    if not folder.is_dir():
        return False
    for path in folder.rglob("*"):
        if path.is_file() and path.suffix.lower() in suffixes and path.stat().st_size > 1_000_000:
            return True
    return False


def _write_manifest() -> None:
    nodes_dir = Path("/opt/ComfyUI/custom_nodes")
    latentsync = LATENTSYNC_SCRIPT.is_file() and _has_weights(OJ / "latentsync", (".pt", ".safetensors", ".ckpt"))
    liveportrait = LIVEPORTRAIT_SCRIPT.is_file() and _has_weights(
        OJ / "liveportrait", (".safetensors", ".pt", ".pth")
    )
    payload = {
        "nodes": {
            "paths": True,
            "ipadapter": (nodes_dir / "ComfyUI_IPAdapter_plus").is_dir(),
            "instantid": (nodes_dir / "ComfyUI_InstantID").is_dir(),
            "pulid": (nodes_dir / "PuLID_ComfyUI").is_dir(),
            "controlnet_aux": (nodes_dir / "comfyui_controlnet_aux").is_dir(),
            "latentsync": latentsync,
            "musetalk": False,
            "liveportrait": liveportrait,
            "hallo": False,
            "longcat": False,
            "talking_head": bool(latentsync or liveportrait),
        }
    }
    try:
        OJ.mkdir(parents=True, exist_ok=True)
        (OJ / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        return


def _input_path(name: str) -> Path:
    raw = Path(name)
    if raw.is_file():
        return raw
    candidate = Path(folder_paths.get_input_directory()) / name
    if candidate.is_file():
        return candidate
    raise FileNotFoundError(name)


def _ffmpeg_still(image: Path, audio: Path, dest: Path) -> None:
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-loop",
            "1",
            "-i",
            str(image),
            "-i",
            str(audio),
            "-c:v",
            "libx264",
            "-tune",
            "stillimage",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(dest),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _ensure_latentsync_checkpoints() -> None:
    """Point /opt/LatentSync/checkpoints at PVC weights under loras/_oj/latentsync."""
    root = Path("/opt/LatentSync")
    ckpt_link = root / "checkpoints"
    src = OJ / "latentsync"
    unet = src / "latentsync_unet.pt"
    whisper = src / "whisper" / "tiny.pt"
    if not unet.is_file() or not whisper.is_file():
        raise RuntimeError(
            "LatentSync weights missing under loras/_oj/latentsync "
            "(need latentsync_unet.pt and whisper/tiny.pt)"
        )
    try:
        if ckpt_link.is_symlink() or ckpt_link.is_file():
            ckpt_link.unlink()
        elif ckpt_link.is_dir() and not any(ckpt_link.iterdir()):
            ckpt_link.rmdir()
        if not ckpt_link.exists():
            ckpt_link.symlink_to(src, target_is_directory=True)
    except OSError as exc:
        raise RuntimeError(f"Cannot link LatentSync checkpoints: {exc}") from exc


def _run_latentsync(video: Path, audio: Path, dest: Path) -> None:
    root = Path("/opt/LatentSync")
    if not (root / "scripts" / "inference.py").is_file():
        raise RuntimeError(
            "LatentSync runtime is not installed at /opt/LatentSync. "
            "Weights may be on disk; the inference script is not."
        )
    _ensure_latentsync_checkpoints()
    config = root / "configs" / "unet" / "stage2.yaml"
    if not config.is_file():
        raise RuntimeError(f"LatentSync config missing: {config}")
    cmd = [
        "python3",
        "-m",
        "scripts.inference",
        "--unet_config_path",
        "configs/unet/stage2.yaml",
        "--inference_ckpt_path",
        "checkpoints/latentsync_unet.pt",
        "--video_path",
        str(video),
        "--audio_path",
        str(audio),
        "--video_out_path",
        str(dest),
        "--inference_steps",
        "20",
        "--guidance_scale",
        "1.5",
    ]
    subprocess.check_call(cmd, cwd=str(root))


def _video_from_file(path: Path):
    from comfy_api.latest._input_impl.video_types import VideoFromFile

    return VideoFromFile(str(path))


class SpockifyLatentSync:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("STRING", {"default": ""}),
                "audio": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    FUNCTION = "run"
    CATEGORY = "spockify/open-jealousy"

    def run(self, video, audio):
        plate = _input_path(video)
        wav = _input_path(audio)
        dest = Path(tempfile.mkdtemp(prefix="oj-lips-")) / "lips.mp4"
        _run_latentsync(plate, wav, dest)
        return (_video_from_file(dest),)


class SpockifyTalkingHead:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("STRING", {"default": ""}),
                "audio": ("STRING", {"default": ""}),
                "prompt": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    FUNCTION = "run"
    CATEGORY = "spockify/open-jealousy"

    def run(self, image, audio, prompt):
        still = _input_path(image)
        wav = _input_path(audio)
        work = Path(tempfile.mkdtemp(prefix="oj-talk-"))
        if LIVEPORTRAIT_SCRIPT.is_file():
            dest = work / "talk.mp4"
            subprocess.check_call(
                [
                    "python3",
                    str(LIVEPORTRAIT_SCRIPT),
                    "--source",
                    str(still),
                    "--audio",
                    str(wav),
                    "--output",
                    str(dest),
                    "--prompt",
                    prompt or "",
                ]
            )
            return (_video_from_file(dest),)
        held = work / "held.mp4"
        dest = work / "talk.mp4"
        _ffmpeg_still(still, wav, held)
        _run_latentsync(held, wav, dest)
        return (_video_from_file(dest),)


try:
    for name in ("controlnet", "ipadapter", "instantid", "pulid", "clip_vision"):
        _add(name, OJ / name)
    _link_insightface()
    _link_clip_vision()
    _write_manifest()
except Exception:
    pass

NODE_CLASS_MAPPINGS = {
    "SpockifyLatentSync": SpockifyLatentSync,
    "SpockifyTalkingHead": SpockifyTalkingHead,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SpockifyLatentSync": "Spockify LatentSync",
    "SpockifyTalkingHead": "Spockify Talking Head",
}
