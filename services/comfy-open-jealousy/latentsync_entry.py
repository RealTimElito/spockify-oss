"""Start LatentSync inference after patching a removed transformers name.

Comfy's transformers build dropped ``FLAX_WEIGHTS_NAME``. diffusers 0.32 still
imports it, so ``python -m scripts.inference`` dies before it opens
``checkpoints/latentsync_unet.pt``. This wrapper restores the name, then runs
the same module.
"""

from __future__ import annotations

import runpy
import sys
import types


def _restore(module, name: str, value: str) -> None:
    if module is not None and not hasattr(module, name):
        setattr(module, name, value)


def patch_transformers() -> None:
    import transformers.utils as utils

    _restore(utils, "FLAX_WEIGHTS_NAME", "flax_model.msgpack")
    _restore(utils, "TF2_WEIGHTS_NAME", "tf_model.h5")
    _restore(utils, "TF_WEIGHTS_NAME", "model.ckpt")
    constants = getattr(utils, "constants", None)
    if constants is None:
        try:
            from transformers.utils import constants as constants  # type: ignore
        except Exception:
            constants = None
    for name, value in (
        ("FLAX_WEIGHTS_NAME", "flax_model.msgpack"),
        ("TF2_WEIGHTS_NAME", "tf_model.h5"),
        ("TF_WEIGHTS_NAME", "model.ckpt"),
    ):
        _restore(constants, name, value)


def _stub_deepcache() -> None:
    """inference.py imports DeepCache even when --enable_deepcache is off.

    The helper is unused on this path. A missing package must not stop the
    runner before it opens checkpoints/latentsync_unet.pt.
    """
    if "DeepCache" in sys.modules:
        return
    try:
        import DeepCache  # noqa: F401
    except ModuleNotFoundError:
        stub = types.ModuleType("DeepCache")

        class DeepCacheSDHelper:
            def __init__(self, *args, **kwargs) -> None:
                return None

            def set_params(self, *args, **kwargs) -> None:
                return None

            def enable(self) -> None:
                return None

        stub.DeepCacheSDHelper = DeepCacheSDHelper
        sys.modules["DeepCache"] = stub


try:
    from lipsync_support import install_face_carry_forward as _install_face_carry_forward
except ImportError:
    def _install_face_carry_forward() -> None:
        print("Face carry-forward helper missing; missed frames still abort.", flush=True)


if __name__ == "__main__":
    patch_transformers()
    _stub_deepcache()
    _install_face_carry_forward()
    sys.argv[0] = "scripts.inference"
    runpy.run_module("scripts.inference", run_name="__main__")
