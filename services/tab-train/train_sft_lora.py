#!/usr/bin/env python3
"""PEFT LoRA SFT on ibm-granite/granite-8b-code-base-128k for Tab FIM.

Rank <= 64 (vLLM --max-lora-rank). Saves adapter in PEFT layout suitable for
vLLM hot-swap under TAB_LORAS_DIR / output_dir.
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

from tab_train.fim_format import build_fim_example  # noqa: E402

LOG = logging.getLogger("tab_train.sft")

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


def _ensure_text(row: dict[str, Any]) -> str:
    if row.get("text"):
        return str(row["text"])
    return build_fim_example(
            row.get("prefix") or "",
            row.get("suffix") or "",
            row.get("middle") or "",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="SFT JSONL")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-model", default=os.getenv("TAB_BASE_MODEL", DEFAULT_BASE))
    parser.add_argument("--adapter-name", default="tab-seed")
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--max-seq-len", type=int, default=4096)
    parser.add_argument("--max-steps", type=int, default=-1)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--save-steps", type=int, default=200)
    parser.add_argument("--bf16", action="store_true", default=True)
    parser.add_argument("--no-bf16", action="store_false", dest="bf16")
    parser.add_argument(
            "--gradient-checkpointing", action="store_true", default=True
    )
    parser.add_argument(
            "--no-gradient-checkpointing",
            action="store_false",
            dest="gradient_checkpointing",
    )
    parser.add_argument(
            "--resume-adapter",
            type=Path,
            default=None,
            help="Optional existing PEFT adapter to continue from",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.lora_r > 64:
        LOG.error("lora-r=%s exceeds vLLM max_lora_rank=64", args.lora_r)
        return 2

    rows = _load_rows(args.data)
    if not rows:
        LOG.error("no rows in %s", args.data)
        return 2
    LOG.info("loaded %s SFT rows from %s", len(rows), args.data)

    import torch
    from datasets import Dataset
    from peft import LoraConfig, PeftModel, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
    from trl import SFTTrainer, SFTConfig

    texts = [{"text": _ensure_text(r)} for r in rows]
    ds = Dataset.from_list(texts)

    tok = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    model = AutoModelForCausalLM.from_pretrained(
            args.base_model,
            torch_dtype=torch.bfloat16 if args.bf16 else torch.float16,
            trust_remote_code=True,
    )
    if args.gradient_checkpointing:
        model.gradient_checkpointing_enable()
        model.config.use_cache = False

    if args.resume_adapter and args.resume_adapter.is_dir():
        LOG.info("resuming from adapter %s", args.resume_adapter)
        model = PeftModel.from_pretrained(model, str(args.resume_adapter), is_trainable=True)
    else:
        lora = LoraConfig(
                r=args.lora_r,
                lora_alpha=args.lora_alpha,
                lora_dropout=args.lora_dropout,
                bias="none",
                task_type="CAUSAL_LM",
                target_modules=DEFAULT_TARGETS,
        )
        model = get_peft_model(model, lora)

    model.print_trainable_parameters()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Prefer SFTConfig when available (TRL 0.14+); fall back to TrainingArguments.
    common = dict(
            output_dir=str(args.output_dir / "runs"),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            learning_rate=args.lr,
            logging_steps=args.logging_steps,
            save_steps=args.save_steps,
            bf16=args.bf16,
            gradient_checkpointing=args.gradient_checkpointing,
            report_to=[],
            max_steps=args.max_steps if args.max_steps > 0 else -1,
    )
    try:
        train_args = SFTConfig(
                **common,
                max_length=args.max_seq_len,
                dataset_text_field="text",
        )
        trainer = SFTTrainer(
                model=model,
                args=train_args,
                train_dataset=ds,
                processing_class=tok,
        )
    except TypeError:
        train_args = TrainingArguments(**common)
        trainer = SFTTrainer(
                model=model,
                args=train_args,
                train_dataset=ds,
                tokenizer=tok,
                dataset_text_field="text",
                max_seq_length=args.max_seq_len,
        )

    trainer.train()
    adapter_dir = args.output_dir / args.adapter_name
    adapter_dir.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(str(adapter_dir))
    tok.save_pretrained(str(adapter_dir))
    meta = {
            "adapter_name": args.adapter_name,
            "base_model": args.base_model,
            "lora_r": args.lora_r,
            "n_examples": len(rows),
            "max_steps": args.max_steps,
    }
    (adapter_dir / "tab_train_meta.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
    )
    LOG.info("saved adapter -> %s", adapter_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
