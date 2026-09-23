# Leap docs checklist — 2026-09-18 (Phases 1–5 + deferred closeout)

Sources: Playbook + Forward Plan + OpenCode Parity + Wichy Harness.  
Legend: `[x]` done · `[~]` HOLD with Tim-visible evidence · `[ ]` open

---

## 0. Extraction & process

- [x] Confirm / extract all four leap docx → md
- [~] Playbook `(1)` — still absent; non-`(1)` used
- [x] Board STATUS — **do not kill** (`BOARD_STATUS.md`; preds ~99+)
- [x] Twin DOWN → Spark LiteLLM PF

---

## 1–6. Prior Playbook / Forward Plan

- [x] Phase 0 freeze / LEAP-001…024 (prior)
- [~] LEAP-015 120b — HOLD-VRAM (`cards/HOLD-VRAM-20260918.md`)
- [~] LEAP-019 48h — HOLD (board multi-day)
- [~] Live canary — HOLD same 20b as board; side-channel `bench kernel` + OC free smoke
- [x] Route regret offline

---

## 7. OpenCode Parity

- [x] OC-001…010 (prior window)
- [x] OC-011 dual-harness table — `cards/OC-011-dual-harness.md` (A scored; B HOLD; C provider-missing; free-model side-channel PONG)
- [~] OC-INFRA-01 Serving baseline 120b — HOLD (`HOLD-VRAM-20260918.md`)
- [~] OC-INFRA-02 FP8 KV — HOLD (needs 01)
- [x] OC-INFRA-03 Context policy
- [x] OC-INFRA-04 CC not enabled
- [x] Kill switches / AUDIT-OK

---

## 8. Wichy Harness Phase 0–5

### Phase 0
- [x] `@spockify/harness` extract + CLI re-exports + fixtures + HARNESS.md

### Phase 1 — Control plane
- [x] Parallel tools (order-preserving) + `parallel.test.ts`
- [x] LoopDetector (6 identical hits)
- [x] Replay protection (`ReplayGuard`)
- [x] Kill registry + process group + task cascade tests
- [x] JSONL atomic session + compact helpers
- [x] TaskAgent explore/bash/general; task stripped from children
- [x] Exit tests: loop detect, kill sleep, task cascade, compact intact

### Phase 2 — Beat gaps
- [x] Edit cascade L0–L4 (`editCascade.ts` + tests)
- [x] Write guard READ_REQUIRED
- [x] Session grants + revoke + bash classifier (`permissions.ts`)
- [x] ask_user / grant / revoke tools

### Phase 3 — Extensibility
- [x] Markdown skills loader + activate_skill / list_skills
- [x] Lifecycle HookRegistry
- [x] Napkin `.spockify/napkin.md` (no notebook.db)
- [x] MCP: extend via existing `@spockify/mcp` (proxy deferred; decision in HARNESS.md)

### Phase 4 — Unify clients
- [x] CLI on harness
- [x] IDE: `runAgentTurn` → `runIdeAgentTurn`; kernel symbol free (`check_harness_clients.sh` PHASE4-GREEN)
- [x] Lab: documented as Python policy layer; no second TS loop in `labAgents.ts`
- [x] Grep gate script + adapter assert

### Phase 5 — Eval
- [x] `spockify bench kernel` runs harness suite (no LiteLLM steal)
- [x] Mock-transport Lite-style patch smoke in tests
- [x] Kernel card with commit SHA (`cards/PHASE5-kernel-card.md`)
- [~] Published SWE-Lite scored row still mini-SWE until board completes (honesty; board not killed)

- [x] `npm test` harness **35 pass**
- [x] Non-goals: no Heavy-in-loop; no router workspace tools

---

## 9. Docs / ship

- [x] CHECKLIST / SUMMARY / MISSING / HOLD cards updated
- [x] BENCHMARK_COMPARISON OC-011 addendum
- [x] HARNESS.md Phase 1–5 status
- [x] Commit private + push private + OSS scrub — private `0c6322d`+; OSS `b0f3ae9`

---

## HOLD only (Tim-visible evidence in `cards/HOLD-VRAM-20260918.md`)

| Item | Why still HOLD |
|------|----------------|
| 120b profile / FP8 | ~65GB + board owns 20b; 85Gi avail but eviction risk |
| Live canary on 20b | Same LiteLLM as board |
| Playbook `(1).docx` | File never appeared |
| SWE scored on kernel | Board in flight; mini-SWE remains published harness until done |
| Claim beats Wichy/OpenCode | Forbidden — table is honest, not a beat |
