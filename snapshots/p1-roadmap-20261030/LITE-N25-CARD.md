# Lite N=25 official eval — p1-n25-20261030

- Source preds: `bench-out/lite-full-20260917/preds.json` (mini-SWE × gpt-oss-20b)
- Evaluator: `swebench.harness` via `SWE-bench/SWE-bench_Lite` split `test`
- Submitted: **25** · Completed: **24** · Errors: **1**
- **Resolved: 10/25** · Unresolved: 14
- **Not a Lite board pass@1 %** (slice of 300)

## Resolved
- astropy__astropy-12907
- astropy__astropy-14995
- astropy__astropy-6938
- django__django-10914
- django__django-11001
- django__django-11039
- django__django-11099
- django__django-11179
- django__django-11620
- django__django-11815

## Unresolved
- astropy__astropy-14182
- astropy__astropy-14365
- astropy__astropy-7746
- django__django-10924
- django__django-11019
- django__django-11049
- django__django-11283
- django__django-11422
- django__django-11564
- django__django-11583
- django__django-11742
- django__django-11910
- django__django-11964
- django__django-12125

## Error / patch-apply fail
- django__django-12113 (sitecustomize.py missing in sandbox)

Report: `bench-out/p1-lite-eval-n25/openai__gpt-oss-20b.p1-n25-20261030.json`
