# Restore Spark after SWE-bench Lite board

Bench temporarily prioritized GPU VRAM on prod Spark (`tim@example.local`).

## What was changed for the board

- Stopped Ollama residents other than `gpt-oss:20b` (had unloaded `llama3.1:8b`, `llama3.2:3b`)
- Scaled `vllm-tab` → 0 (Tab FIM)
- Kept `comfyui` at 0 (already idle)
- Kept `xtts` at 1 (Voice)
- Left `ollama`, `litellm`, `openwebui`, `spockify-router` up

## Restore chat / Tab

```bash
ssh tim@example.local
KC='sudo microk8s kubectl -n spockify'
# Tab FIM
$KC scale deploy/vllm-tab --replicas=1
# Warm common chat models as needed (examples):
$KC exec deploy/ollama -c ollama -- ollama run llama3.2:3b ''
# Or rely on normal traffic / ensure-spark-boot to re-pull keep-alives.
# Comfy on-demand stays 0 until image work wakes it via comfyui-gateway.
```

Optional: `./scripts/free-gpu-for-training.sh status` from a checkout with kube context.
