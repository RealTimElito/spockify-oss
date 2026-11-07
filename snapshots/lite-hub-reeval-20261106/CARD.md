# Lite Hub-auth re-eval — started 2026-11-06

- Host: **Spock** (twin `lab@10.0.0.10` unreachable)
- Hub: authenticated as `timelito` (PAT not in git / not logged); stamp `6dc2ce0d`
- Preds: merged `bench-out/lite-full-20260917/preds.json` + predregen×3 overlays → `bench-out/lite-hub-reeval-20261106/preds.json` (300 / 299 nonempty)
- Evaluator: `swebench.harness` · `SWE-bench/SWE-bench_Lite` test · `max_workers=1` · prune watchdog
- GPU: **none** (eval-only; High `matplotlib__matplotlib-25442` sibling left alone on `gpt-oss-20b`)
- Live: `bench-out/lite-hub-reeval-20261106/STATUS.md`

## Scores

| Denominator | Cite until report |
|-------------|-------------------|
| Prior completed | **70/300 (23.3%)** SoT |
| This run | *in flight — do not invent a new %* |

## Notes

- No ERROR/incomplete residuals remained (`errors_remaining=0`); this is the Hub-auth confirmation regrade, not a fresh overnight pred board.
- Push private+OSS only if the report changes the completed-denominator score.
