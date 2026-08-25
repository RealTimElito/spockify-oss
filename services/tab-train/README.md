# Tab train service

See [docs/TAB_TRAINING.md](../../docs/TAB_TRAINING.md).

Quick unit tests (no GPU):

```bash
cd services/tab-train && python3 -m unittest tests.test_filters tests.test_synth_distill -v
```

Synthetic + distill (default teacher: **codestral:22b** Ollama infill):

```bash
../../scripts/tab-train-distill.sh --dry-run
../../scripts/tab-train-distill.sh --smoke
```

Continuous loop: always serve champions (`ensure-loras` + reload on restore);
telemetry + optional distill-data feed the pool; scheduled SFT/KTO/distill
train challengers and `gate_promote` only if they beat (or don't regress vs)
the champion. Enable: `make tab-train-sync && make tab-train-enable-loop`
(after `make tab-train-distill-smoke`). Status: `make tab-train-status`.

Do not use Gemini as teacher (ToS + off-box). Alt: `gpt-oss:20b` with `TAB_TEACHER_API_STYLE=chat`.
