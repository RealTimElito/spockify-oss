SPOCKIFY LAB  ·  AGENT PLAYBOOK
Leap-forward operating manual for agents and subagents
Roles, skills, charters, tickets, handoffs, kill switches, and the exact work each agent is allowed to do. Read with Spockify_Leap_Forward_Plan.docx. If the two conflict on claims, the plan wins. If they conflict on who may touch which file, this playbook wins.
0.  How a swarm is supposed to work here
This leap is not a multi-agent coding product. SPAWN is user-visible parallelism for product UX. The development swarm is a human-directed set of specialized agents with narrow write scopes. They share a ticket log, JSONL traces, and frozen packs. They do not share a group chat that can silently rewrite loop.py.
One Director sequences work. Specialists execute tickets. Subagents are functions, not personalities: they run a scripted job and return artifacts. No subagent merges to main. No specialist changes another specialist’s owned files without a handoff ticket.
Hard concurrency rules
At most one agent writes packages/spockify-lab-agents/ at a time (Loop owner).
At most one agent writes router pick logic at a time (Router owner).
Measurement and Canary may run read-only anytime.
Infra may work in parallel on hosts, Docker, and bench runner, not on loop internals.
Product Surface (IDE/CLI chrome) is frozen for the leap except bugs that block Keep/Undo as the apply path.
Fine-Tune Curator is dormant until Measurement has Lite 0:10 and Trace has ≥200 legal patch traces.
Shared memory every agent must read before acting
docs/BENCH.md — how benches talk to LiteLLM, not the router.
docs/BENCHMARK_COMPARISON.md — non-claims.
snapshots/overnight-20260908 and 20260915 SUMMARY/RESULTS — historical walls.
This playbook — who owns what.
Ticket log (create snapshots/leap-20260916/TICKETS.md if missing).
packs/canary-v1.json and packs/route-v1.json once they exist.
JSONL schema in docs or scripts/bench/schema-trace.v1.json.
1.  Org chart and ownership

Subagents are listed under each charter. They inherit the parent’s write ban. A subagent that needs a file outside parent ownership files a ticket, it does not “just fix it.”
2.  Cross-cutting skills (install these as reusable skills)
These are skill files the swarm should load, not vibes. Name them so agents can request them explicitly.

Minimum skill contract
A skill is a markdown file with: purpose, inputs, outputs, commands, fail codes, files it may touch, files it must not touch, and a 10-line example. If an agent cannot name the skill it is using, it is improvising — Director rejects the PR.
3.  Ticket format every agent must use
Create snapshots/leap-20260916/TICKETS.md. One ticket = one mergeable change or one scored run. Template:
ID: LEAP-024  |  Owner: A4  |  Phase: 1  |  Skill: skill-swe-one-instance
Goal: complete SWE Lite slice 0:1 on gpt-oss-20b think=low.
In scope: scripts/bench template pin, one trajectory dir.
Out of scope: 120b, invent slugs, router, IDE chrome.
DoD: bench-out summary with instance id, pass/fail, wall, turns, infra-or-agent, SHA.
Kill: if image pull blocks >48h, hand to A3, do not retune prompts.
Handoff: A8 may not start 120b row until this ticket is green or infra-fail-classified.
Definition of Ready
Named owner and skill.
Frozen model tag and think if it is a scored run.
Canary still green on current HEAD (A1 stamp).
No other open ticket on the same owned files.
Definition of Done
Artifact path listed.
Canary re-run if loop/router touched.
Trace JSONL valid if a loop ran.
Claims Auditor sign-off if docs or cards changed.
Director checkbox in TICKETS.md.
4.  Role charters (detail)
A0  Leap Director
You are the only agent allowed to declare a phase complete or a stream killed. You do not implement loop internals.
Accept cards only if four-factor complete and infra-fails separated.
Block any PR that adds an invent slug or Heavy-as-coder.
Sequence: canary+traces → SWE 0:1 → patch/git → 20b/120b card → route pack.
Speak publicly only through A11-approved sentences.
Subagents: Phase-gate checker (read TICKETS + cards, emit PASS/HOLD). Calendar/cadence reminder (daily canary, weekly SWE note).
Skills: skill-four-factor-card, skill-nonclaim, skill-one-factor, skill-product-policy.
A1  Canary Guardian
Protect the only quality you already have: 20b micros that go green fast.
Own lab_regress_quick and packs/canary-v1.json (rate, hello, docs, calc, rename).
Budget: pack wall ≤90s on gpt-oss-20b think=low. Tip 61 class (~63s) is the target.
Stamp every loop/router PR with CANARY-GREEN or CANARY-RED plus N passed per fixture.
Never “fix” a red canary by switching to 120b. That hides a harness regression.
Subagents: Fixture runner; Wall watcher (flag >2× median); Docs-size checker (API.md completeness class).
DoD for a stamp: command, host, model, think, per-eval pass and wall, git SHA.
A2  Trace Steward
If it is not in JSONL, it did not happen.
Schema v1 fields (required): ts, ticket, sha, host, role (orch|exec|router|swe), model, think, tools[], writes[], pytest {n_pass,n_fail,tail}, rounds, wall_s, tokens, stop_reason (early-stop|max-rounds|timeout|user|sandbox|infra), infra_fail (bool), instance_id (nullable).
Reject traces missing model, think, stop_reason, or wall_s.
Redact secrets before any snapshot export to OSS.
Index trajectories under bench-out/ and a gitignored raw store; keep redacted summaries in snapshots/leap-*/.
Subagents: Schema validator; Redactor; Trajectory summarizer (one page per instance: goal, picks, diffs files, last fail, outcome).
A3  Infra Host
You exist because aarch64 twin blocked SWE Docker. That is the leap bottleneck.
Prove LiteLLM :4000 compose and :30400 twin. Agent benches do not use router :4100/:30100.
Get instance sandboxes: Podman/Docker. Prefer a small amd64 box over infinite qemu pain. Log pull-wall separately.
Never wipe Ollama models between runs. Concurrency 1, maybe 2.
Spark/prod: short canaries and SPAWN smoke only. No multi-hour SWE.
Subagents: Reachability probe (/v1/models + tiny chat); Disk/GPU sentry; Image-pull runner with digest pin.
Kill: if 48h of pulls fail, write INFRA-BLOCK and stop A4 from retuning prompts.
A4  SWE Runner
Your only job in Phase 1 is one finished Lite instance.
Pin mini-swe-agent version. Template uses {{task}} (v2), not {{problem_statement}} — this already failed once.
spockify bench dry-run; smoke --model gpt-oss-20b; swe --subset lite --slice 0:1 --workers 1.
Classify outcome: resolved / not-resolved / infra-fail. Infra-fail is not a model score.
Hand A8 nothing until 0:1 has a trajectory folder and a one-page summary.
Out of scope: changing loop.py to “help” a single instance; adding slugs; raising think without a ticket.
Subagents: Template linter; Slice expander (only when Director opens Lite 0:10); Preds packager.
A5  Loop Engineer
You own the closed loop that overnight tips 23–87 already made healthy. Your job is to turn gates into a state machine, not to collect more R1 invents.
States: plan → exec → verify → repair → done|abort. DONE during verify-needed goals is a harness bug (tip 07 q0). Reasoning-only stubs retry once at think=low (tip 52–53). Already-green preseed stops R1 (tip 58). Open fences and empty WRITE rejected (tip 52). Nested fences do not early-stop mid-docs (tip 57). Post-WRITE pytest kept (tip 49).
May edit loop/shell_tool/llm in lab-agents when you hold the write lock.
Must run A1 canary after every change.
Must emit traces via A2 schema.
Must not change default model.
Subagents: State-machine tester; Prompt-compiler (keep bootstrap tip 23 as a flag, not a silent dependency for SWE cards); Historical-gate porter (re-express tips 07/10/50/53/58 as unit tests).
A6  Patch and Git Transaction
This is the highest-leverage product change after measurement. Big-dog loops apply a patch and reset.
One legal write format (unified diff or search-replace — pick one in LEAP-first ticket and freeze).
Reject raw full-file dumps and the non-chosen format with a harness note, not a model essay.
snapshot HEAD before first WRITE; reset --hard on red oracle; on green, one optional commit or stash for Keep.
File budget N (default 4) unless goal lists files.
Never WRITE test_*.py unless goal says so (tip 32).
IDE Keep/Undo must call the same applicator (handoff to A15). Subagents: Diff parser; Reset verifier; File-budget linter.
A7  Oracle and Sandbox
Canary oracle = local pytest. Industry oracle = container per instance with hidden tests.
Wrap test commands; return fail-object {cmd, exit, tail, failed_nodeids[]}.
Allowlist network/fs/commands on SWE instances.
Taxonomy: agent-fail vs infra-fail vs oracle-misconfig.
Subagents: Pytest parser; SWE harness adapter; Allowlist auditor.
A8  Model Card
You do not pick winners in Slack. You fill rows.
Required rows on a frozen slice, one factor at a time: 20b think=low; 120b think=low; 120b think=high; escalate 20b→120b-high on first red. Private twin-only memo: Devstral stock vs abliterated — never a homepage row.
If 120b-high pass is within noise of 20b, say so. Do not “default to 120b because we have it.”
If think=high multiplies wall ~3× without pass lift, Heavy stays a user toggle.
Skills: skill-four-factor-card, skill-one-factor, skill-infra-fail.
A9  Router Policy (spockify-auto)
eval_board is a prompt arena. make benchmark-router is latency. Neither is your score.
Build packs/route-v1.json (~80–120 labeled items): family, oracle_model, oracle_think, forbidden_models, pass_rule. Policies: always-20b, always-120b-high, auto, lab-orch-default.
Metrics: family accuracy; pass@1 by bucket; regret vs oracle; escalation precision/recall; policy violations (must be 0 on spark).
If auto loses to always-20b on easy pass and costs more, auto stays flagged off for coding.
Auto must never resolve abliterated or :cloud on SPOCKIFY_HOST_PROFILE=spark.
Subagents: Pack labeler (human-in-the-loop); Regret printer; Policy linter.
A10  Lab Orch Policy
Orch plans and reviews. Exec patches and runs. Orch does not WRITE product files. Escalation: think=low first; think=high once after a real fail-object; no SPAWN on single-file canaries; bootstrap flag explicit on SWE cards.
Assignment tests are traces graded against a policy file, not a vibe. Subagents: Role-split linter; Escalation counter; SPAWN-guard.
A11  Claims Auditor
You are the immune system for BENCHMARK_COMPARISON.md.
Allowed: internal micros walls; “SWE path instrumented”; four-factor cards.
Forbidden: beats OpenCode/Cursor/Claude Code; Spockify 80%; quality 10 = frontier skill; abliterated as product model.
Every card PR needs your line: AUDIT-OK or AUDIT-BLOCK + the sentence that would leak.
A12  Red Team
Replay the overnight failure modes as fixtures so A5 cannot regress them: 01 skip-exec, 06 undo-after-fix, 07 multi-JSON stop, 09–10 bad WRITE fence, 13 shop timeout class, 49–50 DONE-loop, 52 stub, 57–58 already-green thrash, 65 ModuleNotFound stub.
You do not invent new eval slugs. You encode old pain.
A13  Competitor Slice (Phase 5 only)
Same frozen instances, same open model tag if the other harness will host it. If it will not, write “harness refused tag,” not a winner. Out of scope until A4+A8 have Lite 0:10 or Verified 0:25.
A14  Fine-Tune Curator (dormant)
Wake only when A4 has Lite 0:10 and A2 has ≥200 traces with legal patches and fail-objects. Then: SFT exec on (fail-object + excerpt)→patch; SFT orch on goal→one JSON object. No RL until holdout SWE exists. No promoting abliterated LoRAs to product defaults. Datasets live in a private store, not the OSS export.
A15  Product Surface
Leap scope is narrow: Keep/Undo and the review bar must call A6’s applicator. HUD, /think chrome, SPAWN labels already shipped — do not expand chrome. Tab/FIM and Codestral stay on their own bench. Voice/Comfy/XTTS out of scope.
5.  Phase map onto agents
6.  Parallelism matrix
Green = can run together. Red = write-lock conflict. Yellow = read-only / wait for artifact.
7.  Prompts each agent should prepend
Director injects the standing order from page 1 plus the owner’s charter. Then:
Common suffix
Name your skill. Name your ticket. List files you will touch. List files you will not touch. Run canary if you touched the loop or router. Write traces. Do not mention competitor pass@1 you did not measure. Stop after DoD.
A5 extra
You are improving harness hygiene on a fixed model (gpt-oss-20b for canaries). Historical walls: rate ~293s→~16s at tip 50; Spark rate ~8–11s at tips 53–87. Do not sacrifice those. Encode gates as tests.
A4 extra
Prefer LiteLLM. Workers=1. Slice stays 0:1 until Director opens 0:10. Template {{task}}. If Docker fails, return INFRA-FAIL and stop.
A9 extra
Score regret, not eloquence. Product profile spark forbids abliterated and :cloud. eval_board is out of scope.
A11 extra
Delete any sentence that would still be true if you replaced Spockify with a random pytest wrapper. Demand model, harness, subset, date.
8.  Interfaces and file boundaries

Auth: SPOCKIFY_API_KEY / LITELLM_MASTER_KEY / ~/.config/spockify/credentials.json. Agents do not print secrets into snapshots.
9.  Cadence, stand-up, and artifacts
Daily: A1 canary if loop/router changed; A0 reads TICKETS.
Twice weekly: floor pack (shop/ledger/queue) owned by A5+A1, not new slugs.
Weekly: A4 or A8 writes one failure-mode note (even if infra-fail).
Per tag: four-factor card or explicit NO-SCORE.
Stand-up format (async, 8 lines max): ticket id, owner, blocked-by, artifact path, canary stamp, next ticket, ask for Director.
Required artifact folders
snapshots/leap-20260916/TICKETS.md  ·  packs/canary-v1.json  ·  packs/route-v1.json  ·  scripts/bench/schema-trace.v1.json  ·  bench-out/ (gitignored raw)  ·  snapshots/leap-20260916/cards/  ·  snapshots/leap-20260916/redteam/
10.  Kill switches and escalation
11.  First 15 tickets (copy into TICKETS.md)
LEAP-001 A2 schema-trace.v1.json + validator.
LEAP-002 A1 packs/canary-v1.json + gate script wrapping lab_regress_quick.
LEAP-003 A0 TICKETS.md + standing order pinned.
LEAP-004 A12 red-team fixture list mapped to tips 01,06,07,10,13,50,53,58,65.
LEAP-005 A3 LiteLLM reachability matrix compose/twin; document forbidden router use.
LEAP-006 A3 Docker/Podman decision (amd64 vs qemu) written down.
LEAP-007 A4 pin mini-swe-agent + {{task}} template lint.
LEAP-008 A4 dry-run + smoke 20b.
LEAP-009 A4 SWE Lite 0:1 20b think=low — THE ticket.
LEAP-010 A11 card template paragraph in BENCHMARK_COMPARISON.md (empty numbers OK).
LEAP-011 A6 choose patch format; implement reject-other.
LEAP-012 A6 git snapshot/reset helpers + test.
LEAP-013 A7 fail-object schema wired into verify state.
LEAP-014 A5 state-machine tests for DONE-during-verify and stub-retry.
LEAP-015 A8 blocked until 009 has a trajectory; then 120b ± think on THAT instance only.
Do not open LEAP-040 “add four invents” or LEAP-041 “enable Heavy for coding.” Those are anti-tickets.
12.  What “good agent work” looks like vs thrash
13.  Recap of the leap the swarm is serving
Overnight tips 50–87 proved the loop can stop on toys (rate ~8–16s q10; five-task pack ~63s; invents often R1). Claude Code / Cursor / OpenCode / Aider live on hidden-test repo repair and (for some) published boards. The swarm’s job is not to feel like Cursor. It is to produce a stranger-reproducible four-factor card, a patch+git loop, and a router that spends 120b only when 20b has lost.
Models you have (120b, high think, abliterated Devstral) are factors for A8/A9 private or scored rows. They are not a substitute for LEAP-009.
If an agent cannot point to a ticket in section 11 or a later Director-opened ticket, it should idle. Idling is cheaper than another overnight of easy greens.
14.  48-hour continuous loop (keep it running)
Name the run: LEAP-LOOP-48H. Director sets START_TS and END_TS = START + 48h. Default window: start when canary-v1 and trace schema exist (after LEAP-001–003). Do not start a 48h burn on prod Spark GPUs. Twin or compose for canaries; SWE only if A3 has declared the host safe.
What “the same loop” means
One cycle is fixed. Agents may not add steps mid-run.

A cycle that finishes early waits. A cycle that overruns is killed at the next heartbeat if it exceeds its budget (canary 10 min, floor 25 min, red-team 20 min, SWE slice 0:1 up to 90 min then classify infra-or-timeout).
Scheduler sketch (unattended)
Implement as snapshots/leap-20260916/loop48.sh or a systemd/user timer. Pseudo-flow:
while now < END_TS: run C3; if due C1 then A1; if C1 RED then page Director and freeze C4/C6; if due C2 then A2; if due C5 then A12; if A3 HOST-GREEN and no SWE in flight then A4 one instance; if due C7 then A8; sleep 60s.
Persist state in snapshots/leap-20260916/loop48-state.json: next_due per slot, inflight ticket, last_canary, consecutive_red, host_flag. Crash-restart must resume from state, not start a second SWE worker.
Hard rules for the 48 hours
One SWE worker. Never two instances, never two models on the same instance in parallel.
Model frozen per in-flight ticket. 20b for canary always. 120b only on a Director-preapproved instance list.
No new invent slugs, no HUD copy, no Heavy, no abliterated on spark, no router training.
Canary RED twice in a row → freeze C4 and C6, keep C1+C2+C3 only, wait for human/Director.
LiteLLM unreachable → INFRA-BLOCK, loop becomes heartbeat + reachability probe only.
Disk >90% or GPU temp policy trip → stop inference, keep logs.
At END_TS the loop writes a closeout pack and exits 0. It does not “just one more instance.”
Closeout pack (required at hour 48)
loop48-report.md: cycles run, canary green/red counts, median walls vs tip 61 class, SWE instances attempted / resolved / not / infra-fail, traces accepted / rejected.
cards/ appended rows only for finished instances.
TICKETS.md updated; no silent code changes without a ticket id in the report.
A11 one-paragraph public-safe summary (usually: “internal canary stayed green; SWE still N instances”).
Who stays awake vs who is on a timer
Unattended: A1, A2, A3 probe, A4 if host green, A12 sample, A0 heartbeat. Sleeping unless a ticket is already open: A5 write-lock, A6, A9 policy edits, A14, A15. Those owners may review logs after hour 48; they do not hot-patch mid-loop unless canary is RED and Director opened a freeze-fix ticket.
Why 48 hours and not “until it looks good”
A bounded window produces a rate: canaries per day, infra-fail fraction, time-to-next-legal-SWE. An unbounded overnight becomes tip 88–200 of easy greens. If you want another 48h, Director opens LEAP-LOOP-48H-B with the same script and a new END_TS. Same loop. New clock.
LEAP-016 A0+A2 add loop48.sh + state json + heartbeat log.
LEAP-017 A1 wire canary into the 90 min slot with a lock file.
LEAP-018 A3 host health file HOST-GREEN|HOST-BLOCK that C6 reads.
LEAP-019 Director starts 48h only after 001–003 green; ends with closeout pack.

### TABLE 1

| Standing order for every agent Do not add invent slugs. Do not publish a bare percentage. Do not select abliterated or :cloud tags on the spark/prod profile. Do not fold Heavy into the coding harness. Do not change the default model and the loop in the same scored run. If your ticket does not produce a canary-safe artifact, a trajectory, a card, or a policy test, stop and ask the Director. When LEAP-LOOP-48H is armed, run only the fixed duty cycle in section 14 until END_TS — do not invent extra work to fill the clock. |

### TABLE 2

| Agent | Mission | Owns (write) |
| A0 Director | Sequence phases, accept/reject cards, kill streams | TICKETS.md, phase gates, public wording |
| A1 Canary Guardian | Keep 20b micros green | lab_regress_quick.sh, canary pack |
| A2 Trace Steward | JSONL schema, trajectory store | schema, bench-out index, redacted snapshots |
| A3 Infra Host | Docker/Podman, twin, amd64, LiteLLM reachability | scripts/run-swebench.sh host bits, compose bench env |
| A4 SWE Runner | mini-SWE path produces trajectories | scripts/bench/*, templates, pin files |
| A5 Loop Engineer | plan→exec→verify state machine | lab-agents loop/shell/llm (private) |
| A6 Patch/Git | single apply path + reset on red | apply_patch, git snapshot helpers |
| A7 Oracle/Sandbox | instance tests, allowlists, infra-fail taxonomy | sandbox policy, test runner wrappers |
| A8 Model Card | 20b vs 120b vs think tables | cards in snapshots/leap-*/cards/ |
| A9 Router Policy | spockify-auto regret | route pack, router policy tests |
| A10 Orch Policy | role split + escalation | orch assignment tests |
| A11 Claims Auditor | docs stay honest | BENCH.md, BENCHMARK_COMPARISON.md addenda |
| A12 Red Team | replay historical fail modes | regression fixtures from tips 01–58 |
| A13 Competitor Slice | same-slice OpenCode/Aider later | external runner notes only |
| A14 Fine-Tune (dormant) | SFT data from traces | datasets/ only, never prod tags |
| A15 Product Surface | IDE/CLI apply path only | Keep/Undo applicator glue |

### TABLE 3

| Skill id | Teaches | Required by |
| skill-canary-run | How to run lab_regress_quick; interpret N passed vs wall | A1, A5, A12 |
| skill-trace-jsonl | Emit/validate one turn object | A2, everyone who runs a loop |
| skill-litellm-only | Agent benches hit LiteLLM :4000/:30400, never router :4100 | A3, A4, A8, A9 |
| skill-swe-one-instance | slice 0:1, workers 1, pin mini-swe, save preds | A4, A3 |
| skill-infra-fail | Classify image-pull / OOM / timeout vs agent-fail | A3, A4, A7, A8 |
| skill-patch-apply | One format; reject the other; no raw file dump | A6, A5, A15 |
| skill-git-txn | snapshot before first WRITE; reset on red | A6, A7 |
| skill-fail-object | Last pytest tail as schema, not prose | A5, A7 |
| skill-four-factor-card | date×model×think×harness×subset×N×pass×wall | A8, A11, A0 |
| skill-route-regret | Score auto vs always-20b vs oracle | A9, A10 |
| skill-product-policy | No abliterated, no :cloud, no Heavy-as-coder | A0, A9, A11 |
| skill-nonclaim | Forbidden marketing sentences | A11, A0 |
| skill-one-factor | Do not change loop and model in one scored run | A5, A8, A0 |

### TABLE 4

| Phase | Primary owners | Exit the Director will accept |
| 0 Freeze + instrument (d1–3) | A0 A1 A2 A12 | canary-v1 + JSONL schema + TICKETS.md + red-team fixture list |
| 1 One SWE trajectory (d3–21) | A3 A4 A2 A11 | Lite 0:1 summary: resolved|not|infra-fail |
| 2 Loop shape (w3–7) | A5 A6 A7 A15 A1 | patch+reset on red; canary still green |
| 3 Model cards (w5–9) | A8 A4 A3 | 20b vs 120b ± think on frozen slice |
| 4 Router/orch (w6–10) | A9 A10 A1 | regret table; 0 policy violations |
| 5 Publish (w10–13) | A11 A13 A0 | addendum in BENCHMARK_COMPARISON.md |
| 6 Product depth later | A15 + index work | only after Phase 1 green |

### TABLE 5

| If this owner is writing | May run in parallel | Must wait |
| A5 loop | A1 read, A2 ingest, A3 hosts, A12 fixture design | A6/A7 merging into loop files |
| A6 patch/git | A3, A8 analysis, A9 pack labeling | A5 same files; A15 applicator glue after API freeze |
| A4 SWE runner | A1, A9 pack, A12, A11 docs drafts | A3 INFRA-BLOCK |
| A9 router | A5 loop, A4 SWE (different code) | A10 if they share pick policy module |
| A8 cards | everyone except A11 publish | A4 trajectory existence |

### TABLE 6

| Surface | Who writes | Who calls |
| LiteLLM /v1/chat/completions | nobody in leap (ops only) | A4 A5 A8 A9 benches |
| Router :4100 chat routing | A9 policy only | chat product, not SWE |
| spockify lab orch/exec | A5 A6 A7 via handoff | canary + internal floor pack |
| mini-SWE-agent | A4 templates | SWE slices |
| IDE Keep/Undo | A15 after A6 API freeze | humans |
| OSS docs BENCH + comparison | A11 | public |
| Private lab-agents package | A5 A6 | twin; stripped from OSS export |

### TABLE 7

| Trigger | Who fires | Effect |
| Canary red on 20b after a loop PR | A1 | Revert or fix before any other ticket merges |
| SWE image pull blocked 48h | A3 | INFRA-BLOCK; A4 stops prompt tweaks |
| Auto loses easy bucket to always-20b | A9 | Auto coding path flagged off |
| 120b-high pass ≈ 20b on slice | A8 | Do not advertise 120b as default coder |
| Policy violation (abliterated on spark) | A9/A11 | Treat as Sev-0; patch picker |
| PR adds invent slug or Heavy-as-coder | A0/A11 | Reject |
| Fine-tune requested early | A14/A0 | Stay dormant |

### TABLE 8

| Good | Thrash |
| One instance trajectory with infra-vs-agent label | Ten invent slugs all R1 green |
| Canary stamp on a loop PR | “Works on 120b-high so ship it” |
| Reset-on-red demo on ledger fixture | New HUD copy |
| Regret table where auto loses honestly | eval_board screenshot |
| AUDIT-BLOCK on a boastful README line | Quality 10 cited as SWE skill |

### TABLE 9

| Intent Run the same test/eval duty cycle unattended for 48 hours. This is a repeatable measurement loop, not a second invent-slug overnight. If the loop cannot find a legal next ticket, it idles until the next clock slot. It does not invent work. |

### TABLE 10

| Slot | Every | Owner | Job |
| C1 Canary | 90 min | A1 | lab_regress_quick / canary-v1 on gpt-oss-20b think=low; stamp GREEN/RED + walls |
| C2 Trace flush | 90 min | A2 | Validate JSONL since last slot; reject incomplete turns |
| C3 Heartbeat | 30 min | A0 subagent | Write LOOP-ALIVE line: ts, slot, last stamp, blocked-by |
| C4 Floor pack | 6 h | A5+A1 | shop/ledger/queue only if those fixtures exist; else skip |
| C5 Red-team sample | 8 h | A12 | Replay one historical fail fixture (07, 50, 53, or 58) |
| C6 SWE attempt | when host green | A4 | At most one Lite instance at a time; workers=1 |
| C7 Card drip | 12 h | A8 | Append any finished instance row; never a new model mid-instance |
| C8 Idle | if nothing legal | all | Sleep until next C1. Do not open new tips |