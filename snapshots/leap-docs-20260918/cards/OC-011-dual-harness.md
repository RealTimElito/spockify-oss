# OC-011 dual-harness comparison — 2026-09-18T22:57:23+02:00

## Constraint
- Lite board `lite-full-20260917` owns gpt-oss-20b on Spark LiteLLM PF :24001 — **do not steal**.
- Twin DOWN. 120b HOLD-VRAM (needs ~65Gi; board + chat residency).

## Row A — Spockify × gpt-oss-20b (prior scored)
| Field | Value |
|-------|-------|
| Harness | mini-SWE-agent 1.14.4 (board path); kernel Phase 5 mock smoke separate |
| Model | gpt-oss-20b |
| Slice | Lite 0:1 sqlfluff__sqlfluff-1625 |
| pass@1 | **1/1 resolved** (LEAP-024) — not a board % |
| Card | snapshots/leap-20260916/cards/sqlfluff__sqlfluff-1625.md |

## Row B — Spockify × gpt-oss:120b
| Status | **HOLD-VRAM** — not run this window |
| Evidence | See HOLD-VRAM-20260918.md |

## Row C — OpenCode × same local tag
| Status | **not run — provider** for gpt-oss:120b/20b |
| OpenCode | 1.18.31 |
| Default catalog | hosted free tags only (no local gpt-oss) |

## Side-channel (non-conflicting): OpenCode free model smoke
Fixture: /tmp/oc011-YgZk (local assert only; no Spark LiteLLM).
