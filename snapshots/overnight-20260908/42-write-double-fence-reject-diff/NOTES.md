# 42 — WRITE double-fence recovery + reject unified diffs

## Keep (on top of 41 / 39 / 34)
1. Recover `WRITE:\n```\n```lang\nbody```` (empty first fence glitch).
2. Reject unified-diff WRITE bodies — demand full file contents.
3. Prior: invent assert-first, auto-verify cap, stop-after-pytest, RUN parenthetical strip.

## Motive
Rate thrash (~326s): empty WRITE fences + orch verify gap after failed applies.

## Do not undo
23 / 27 / 29 / 31 / 34 foundation.
