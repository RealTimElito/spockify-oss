"""Tab model training: seed/synth/distill SFT, telemetry SFT/KTO, eval, promote.

Champion/challenger gate + reload-on-restore keep the best LoRA served 24/7;
training stays scheduled on the shared cluster GPU.
"""

__version__ = "0.3.0"
