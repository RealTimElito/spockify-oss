# Slice S freeze note — OC-011

**Status:** not frozen for dual-harness publish yet.

| Item | Value |
|------|-------|
| Intended S | SWE-bench Lite `0:10` first; Verified `0:25` when host allows |
| Spockify row A | gpt-oss-20b think=low — board + prior sqlfluff 0:1 |
| Spockify row B | gpt-oss:120b think=high — HOLD-VRAM |
| OpenCode row C | **not run — provider** (see OC-008 card); no foreign Opus % |
| Board | `bench-out/lite-full-20260917/` in flight — do not kill |
| Kernel | Until Wichy Phase 5, published harness row must not claim `@spockify/harness` wins; mini-SWE remains current scored path |

When board finishes and OpenCode local-tag path exists, fill BENCHMARK_COMPARISON §8 addendum with A/B/C-or-explicit-missing.
