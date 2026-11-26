# mini-swe-agent pin (LEAP-007)

Pin file for SWE runner. Install with:

```bash
./scripts/run-swebench.sh swe --install --dry-run --subset lite --slice 0:1
# or: .venv-bench/bin/pip install 'mini-swe-agent==1.14.4'
```

| Field | Value |
|-------|-------|
| package | `mini-swe-agent` |
| pin | `1.14.4` |
| template contract | `{{task}}` (v2) — **not** `{{problem_statement}}` |
| template path | `scripts/bench/spockify-swebench.yaml.tmpl` |
| workers default | `1` |
| subset first run | `lite` |
| slice first run | `0:1` |

## Template lint

```bash
./scripts/bench/lint_swe_template.sh
```

Must fail if `problem_statement` appears without `{{task}}`.
