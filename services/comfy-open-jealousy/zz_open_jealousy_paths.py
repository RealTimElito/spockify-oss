"""Open Jealousy paths and lip/talk nodes.

Adds Comfy search paths for weights stored under the mounted loras/_oj tree
(controlnet, ipadapter, instantid, pulid, insightface) and writes a cold
manifest the router can read without calling /object_info.

SpockifyLatentSync / SpockifyTalkingHead run only when a local runner and
weights are present. Import of this file must not break Comfy startup.
"""

from __future__ import annotations

import importlib.util
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


def _support():
    """Sibling helper. Comfy loads this file by path, so a bare import may miss it."""
    path = Path(__file__).with_name("lipsync_support.py")
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("lipsync_support", path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _failure_detail(stderr: str, stdout: str, code: int, *, prefix: str) -> str:
    support = _support()
    if support is None:
        tail = (stderr or stdout or "").strip().splitlines()
        text = tail[-1].strip() if tail else f"exit {code}"
        return f"{prefix}: {text}"[:700]
    return support.failure_detail(stderr, stdout, code, prefix=prefix)


def _run_checked(cmd: list[str], *, cwd: str | None, prefix: str) -> None:
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if proc.returncode == 0:
        return
    raise RuntimeError(
        _failure_detail(proc.stderr or "", proc.stdout or "", proc.returncode, prefix=prefix)
    )


def _ffmpeg_still(image: Path, audio: Path, dest: Path) -> None:
    """Hold a still for the length of the wav.

    yuv420p needs even width and height. 1085x1450 fails libx264; floor each
    odd side by one pixel. That is a crop, not an upscale.
    """
    support = _support()
    even_scale = (
        support.EVEN_YUV420_SCALE
        if support is not None
        else "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    )
    _run_checked(
        [
            "ffmpeg",
            "-y",
            "-loop",
            "1",
            "-i",
            str(image),
            "-i",
            str(audio),
            "-vf",
            even_scale,
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
        cwd=None,
        prefix="ffmpeg failed",
    )


def _latentsync_python() -> str:
    """Isolated interpreter when the Comfy venv's transformers cannot import diffusers."""
    configured = os.environ.get("SPOCKIFY_LATENTSYNC_PYTHON", "/opt/latentsync-venv/bin/python")
    if configured and Path(configured).is_file():
        return configured
    return "python3"


def _ensure_latentsync_checkpoints(*, required: bool = True) -> bool:
    """Make the path inference.py opens point at the PVC unet.

    The runner cwd is /opt/LatentSync and the argument is
    checkpoints/latentsync_unet.pt. Weights live under loras/_oj/latentsync.
    Called again at process start so a pod restart does not depend on a
    symlink that only existed in the previous container's writable layer.
    The image also bakes the same link (Dockerfile.latentsync).
    """
    root = Path("/opt/LatentSync")
    ckpt_link = root / "checkpoints"
    src = OJ / "latentsync"
    unet = src / "latentsync_unet.pt"
    whisper = src / "whisper" / "tiny.pt"
    if not unet.is_file() or not whisper.is_file():
        if not required:
            return False
        raise RuntimeError(
            "LatentSync weights missing under loras/_oj/latentsync "
            "(need latentsync_unet.pt and whisper/tiny.pt)"
        )
    opened = ckpt_link / "latentsync_unet.pt"
    opened_whisper = ckpt_link / "whisper" / "tiny.pt"
    if opened.is_file() and opened_whisper.is_file():
        return True
    try:
        if ckpt_link.is_symlink() or ckpt_link.is_file():
            ckpt_link.unlink()
        elif ckpt_link.is_dir():
            # A real checkpoints dir without the unet hides the PVC file.
            shutil.rmtree(ckpt_link)
        if not ckpt_link.exists():
            ckpt_link.symlink_to(src, target_is_directory=True)
    except OSError as exc:
        raise RuntimeError(f"Cannot link LatentSync checkpoints: {exc}") from exc
    if not opened.is_file() or not opened_whisper.is_file():
        if not required:
            return False
        raise RuntimeError(
            "LatentSync runner opens "
            f"{opened} and {opened_whisper}, but those files are not there. "
            f"Weights on disk: {unet} and {whisper}."
        )
    return True


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
    entry = root / "latentsync_entry.py"
    if entry.is_file():
        cmd = [_latentsync_python(), str(entry)]
    else:
        cmd = [_latentsync_python(), "-m", "scripts.inference"]
    cmd += [
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
    _run_checked(cmd, cwd=str(root), prefix="LatentSync failed")


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
            _run_checked(
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
                ],
                cwd=None,
                prefix="LivePortrait failed",
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
    _ensure_latentsync_checkpoints(required=False)
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
