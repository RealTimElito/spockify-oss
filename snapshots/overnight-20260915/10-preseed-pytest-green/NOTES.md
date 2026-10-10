# 10 — tip 58 preseed/auto pytest green

## Tip 58 (on tip 57)
- If preseed `pytest -q` already shows `N passed`, set `pytest_passed` so review
  can stop (avoids 3-round thrash when workspace is already green).
- If DONE on a pytest goal with no WRITE and no harness pass, auto-run
  `pytest -q` once to verify the claim.

## Motive
Spark tip57 rate: fixture already fixed → model claimed pass without RUN →
review blocked for 3 rounds.

## Do not undo
53 stub-retry; 19 early-stop on pytest_passed.
