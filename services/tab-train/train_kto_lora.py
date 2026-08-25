#!/usr/bin/env python3
"""TRL KTOTrainer (unpaired) on Tab telemetry accept/reject.

Practical stand-in for Cursor-style online RL at single-user volume.
Start from the latest SFT adapter when available. GRPO/REINFORCE later if
accept/reject volume grows.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

LOG = logging.getLogger("tab_train.kto")

DEFAULT_BASE = "ibm-granite/granite-8b-code-base-128k"
DEFAULT_TARGETS = [
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
]


def _load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="KTO JSONL")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-model", default=os.getenv("TAB_BASE_MODEL", DEFAULT_BASE))
    parser.add_argument("--adapter-name", default="tab-kto")
    parser.add_argument(
            "--sft-adapter",
            type=Path,
            default=None,
            help="Latest SFT adapter to continue from (recommended)",
    )
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--lr", type=float, default=5e-6)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--max-steps", type=int, default=-1)
    parser.add_argument("--max-length", type=int, default=4096)
    parser.add_argument("--max-prompt-length", type=int, default=3072)
    parser.add_argument("--bf16", action="store_true", default=True)
    parser.add_argument("--no-bf16", action="store_false", dest="bf16")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.lora_r > 64:
        LOG.error("lora-r=%s exceeds vLLM max_lora_rank=64", args.lora_r)
        return 2

    rows = _load_rows(args.data)
    if not rows:
        LOG.error("no rows in %s", args.data)
        return 2

    desirable = sum(1 for r in rows if r.get("label") is True)
    undesirable = sum(1 for r in rows if r.get("label") is False)
    LOG.info(
            "KTO rows=%s desirable=%s undesirable=%s",
            len(rows), desirable, undesirable,
    )
    if desirable < 8 or undesirable < 8:
        LOG.warning(
                "thin KTO signal (need both classes); continuing anyway — "
                "prefer waiting for more fate events"
        )

    import torch
    from datasets import Dataset
    from peft import LoraConfig, PeftModel, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import KTOConfig, KTOTrainer

    ds = Dataset.from_list([
            {
                    "prompt": r["prompt"],
                    "completion": r["completion"],
                    "label": bool(r["label"]),
            }
            for r in rows
            if r.get("prompt") is not None and r.get("completion") is not None
    ])

    tok = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    model = AutoModelForCausalLM.from_pretrained(
            args.base_model,
            torch_dtype=torch.bfloat16 if args.bf16 else torch.float16,
            trust_remote_code=True,
    )
    model.gradient_checkpointing_enable()
    model.config.use_cache = False

    if args.sft_adapter and args.sft_adapter.is_dir():
        LOG.info("starting from SFT adapter %s", args.sft_adapter)
        model = PeftModel.from_pretrained(
                model, str(args.sft_adapter), is_trainable=True
        )
    else:
        lora = LoraConfig(
                r=args.lora_r,
                lora_alpha=args.lora_alpha,
                lora_dropout=0.05,
                bias="none",
                task_type="CAUSAL_LM",
                target_modules=DEFAULT_TARGETS,
        )
        model = get_peft_model(model, lora)

    # KTO needs a reference model; TRL clones from the policy when ref_model=None
    # for PEFT setups in recent versions.
    args.output_dir.mkdir(parents=True, exist_ok=True)
    kto_args = KTOConfig(
            output_dir=str(args.output_dir / "runs"),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            learning_rate=args.lr,
            logging_steps=10,
            bf16=args.bf16,
            gradient_checkpointing=True,
            report_to=[],
            max_steps=args.max_steps if args.max_steps > 0 else -1,
            max_length=args.max_length,
            max_prompt_length=args.max_prompt_length,
    )
    trainer = KTOTrainer(
            model=model,
            ref_model=None,
            args=kto_args,
            train_dataset=ds,
            processing_class=tok,
    )
    trainer.train()

    adapter_dir = args.output_dir / args.adapter_name
    adapter_dir.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(str(adapter_dir))
    tok.save_pretrained(str(adapter_dir))
    meta = {
            "adapter_name": args.adapter_name,
            "base_model": args.base_model,
            "sft_adapter": str(args.sft_adapter) if args.sft_adapter else None,
            "n_examples": len(ds),
            "desirable": desirable,
            "undesirable": undesirable,
            "method": "KTO",
            "note": (
                    "Offline unpaired preference stand-in for Cursor-style online RL; "
                    "not policy-gradient at Cursor scale."
            ),
    }
    (adapter_dir / "tab_train_meta.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
    )
    LOG.info("saved KTO adapter -> %s", adapter_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
