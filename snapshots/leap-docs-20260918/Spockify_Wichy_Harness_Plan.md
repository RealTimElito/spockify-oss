ENGINEERING PLAN  ·  DRAFT FOR IMPLEMENTATION
Beat Wichy on the harness
One shared coding-agent kernel for CLI, IDE, and lab. Steal the control plane wiiha/wichy v0.5.0 already shipped. Beat the gaps Wichy listed against itself: edit reliability, write guards, evals, and a product that can actually run the loop.
Item
Value
Status
Draft for implementation — not a press claim
Against
wiiha/wichy v0.5.0 (MIT) · AgentCore + TaskAgent + kill registry
In
Spockify/spockify-oss · loop.ts + router Heavy + missing lab-agents
Horizon
12 weeks to parity+ · 20 weeks to a published Lite slice
Non-goal
Do not fold Heavy ensemble into the coding loop
Fits leap set
This is the kernel. OpenCode-parity is the exam. Canary still gates merges.

Relation to the other leap docs
Leap Forward Plan = strategy and canary. Agent playbook = who may write what. OpenCode-parity = same-slice scoreboard. This document = extract @spockify/harness and beat Wichy’s control plane. First-party SWE (OC-009+) must call this kernel, not mini-SWE-agent, once Phase 5 starts.
# 1.  What winning the harness means
Wichy wins today because one loop survives reality: parallel tools, loop detection, kill that murders a process group and a child agent, isolated task contexts, hooks, skills, MCP, and tests on those paths. Spockify wins the house around the loop (routing, IDE, GPU compose) and loses the loop itself.
Winning is not more files in GitHub. If a row below is not green, we have not beaten Wichy. We have shipped another surface.
Test
Wichy today
Spockify must hit
One kernel, three clients
Yes (REPL / pipeline / server)
CLI + IDE + lab share one package
Parallel tool exec
ThreadPool 8
Same-turn parallel, order-preserving results
Loop detect
SHA of name|args|result
Same, plus edit-hash after format-on-save
Kill in flight
Registry + cascade + tests
AbortSignal + process-group + TaskAgent cascade
Sub-agents
Typed TaskAgent, no recurse
explore / bash / general with tool subsets
Edit reliability
Exact match only (known gap)
Cascade: exact → ws-norm → anchors → patch
Write guard
Prompt only (known gap)
Must have read path in last N turns
Compact safety
Risk of drop-on-fail
Temp context → validate → atomic swap
Skills + hooks
First class + tests
Markdown skills + lifecycle hooks
First-party eval
None
Sliced SWE-Lite on OUR loop, not mini-SWE-agent
Local-model tools
Native tools assumed
Native + tool fence + repair pass

Wichy’s notes/harness-improvement-suggestions.md (28 Mar 2026) already admits edit cascade, write-file guard, compaction recovery, and approval persistence are missing. That is the attack surface. Do not copy their backlog. Ship it first.
# 2.  Do not do these things
Do not vendor wichy into services/. MIT allows it. Split-brain (Python next to a TS CLI next to a 357 KB router) is how you stay behind.
Do not put the coding loop in services/router/main.py. The router picks models and runs Heavy chat workers. It is not a workspace agent.
Do not treat Heavy (Explorer / Analyst / Builder / Skeptic) as a coding harness. Banned from bench per docs/BENCH.md.
Do not grow loop.ts in place until it is 3,000 lines. Extract a package.
Do not leave lab-agents as an out-of-tree Python child. That is why the public export has a wrapper and no kernel.
Do not claim Cursor / Claude Code / Wichy / OpenCode numbers until bench runs the Spockify kernel.
# 3.  Target architecture
New package: packages/spockify-harness. TypeScript. CLI and IDE import it. Lab is a consumer of the same API. Python stays LiteLLM, Ollama, SearXNG, orchestrator JSON, Heavy chat, eval_board. The kernel talks to models only through ModelTransport.
Package
Owns
Does not own
@spockify/harness
Loop, tools, kill, compact, skills, task agents, events
HTTP routing, GPU, OWUI
@spockify/cli
REPL, TUI, login, slash commands
Tool implementations
extensions/spockify
Apply UX, composer, checkpoints UI
A second loop
@spockify/codebase
Index / hybrid search as a tool backend
Agent policy
@spockify/shadow-workspace
Isolated apply / revert
The turn loop
services/router
Model pick, Heavy chat, search grounding
read_file / shell / task
spockify lab
Orch/exec policy on top of harness TaskAgents
Its own tool runtime

### Kernel API (freeze week 1)
runHarness({ transport, session, tools, policy, signal, onEvent }) → AsyncIterable<HarnessEvent>
Events: status, model, text, thinking, toolStart, toolResult, toolKilled, loopWarning, compact, taskSpawn, taskDone, askUser, done, error. CLI, TUI, IDE, and lab render the same stream. A side channel means the design has forked.
### Session object
messages[] roles system / user / assistant / tool
tick (monotonic, persisted; staleness, not decoration)
readSet: paths read this session (write/edit guard)
toolLog: signatures for loop detect and replay protection
todos[], napkin excerpt, active skill ids
persist JSONL under .spockify/sessions/ with temp → fsync → rename
# 4.  Steal from Wichy (contracts, not modules)
Reimplement in TS. Keep MIT notice in NOTICE if any code is adapted.
Wichy piece
Read
Destination
AgentCore tool batch + parallel
src/wichy/agent/core.py
harness/loop.ts
LoopDetector
src/wichy/agent/loop_detector.py
harness/loopDetect.ts
TaskAgent isolation + no recurse
tools/task/base.py
harness/taskAgent.ts
Kill registry + cascade
tools/kill_registry.py
harness/kill.ts
JSONL atomic context
context/handler.py
harness/session.ts
Tool metaclass / registry
tools/base.py + registry.py
harness/registry.ts
Skills loader + scripts
skills/loader.py
harness/skills.ts
Lifecycle hooks
hooks/* + tests/hooks
harness/hooks.ts
Destructive bash classifier
tools/bash.py
harness/tools/shell.ts
MCP tool proxy
mcp_host/tool_proxy.py
extend packages/spockify-mcp

Do not steal DuckDB-as-default, matplotlib chart zoo, NiceGUI notes, Flask :7891. Spockify already has OWUI and an IDE.
# 5.  Ship what Wichy does not have
### 5.1 Edit cascade (their #1 gap)
Layer 0: exact old_string.
Layer 1: whitespace-normalized match.
Layer 2: first-line + last-line anchors, replace the span.
Layer 3: unified diff / patch-ng.
Layer 4: refuse full overwrite unless just-read and policy allows. Return the failing hunk.
Normalize tool outputs before they re-enter context. Sweep/Cline documented this drift. Wichy wrote the note and did not ship it.
### 5.2 Write guard
write_file on an existing path fails unless that path is in session.readSet from the last K turns (K=3). Structured error READ_REQUIRED. Claude Code #27137 class (silent TOC deletion).
### 5.3 Permission memory
Ask / Agent / YOLO already exist. Extend: session grants (“bash npm *”, “edit src/**”) until /revoke or exit; shell classifier (network, rm, dd, chmod, docker, kubectl delete) auto / ask / deny; IDE checkpoints + shadow-workspace roll back granted writes.
### 5.4 Local-model tool repair
Keep tool fences. If the model emits a command in a markdown fence and zero tool_calls, inject one repair turn: “that was not a tool call; emit a tool call now.” Weak OSS models are the home field. Wichy assumes native function calling.
### 5.5 First-party eval
Stop wrapping mini-SWE-agent as the scored agent after Phase 5. Point SWE-Lite slices at runHarness. Until then BENCHMARK_COMPARISON.md stays silent on harness wins. This is how OpenCode-parity OC-009+ stays honest.
### 5.6 Codebase tool + shadow apply
Expose @spockify/codebase and shadow-workspace as harness tools: codebase_search, apply_patch, checkpoint. Advantage only if the kernel calls them.
# 6.  Phased plan
Phase
Weeks
Ships
Kill if
0 Extract
1
Shared package + fixtures
CLI still has a private loop
1 Control
2–4
Parallel, kill, task, compact
No cascade test
2 Beat gaps
5–7
Edit cascade, write guard, grants
edit_file still exact-only
3 Extensibility
6–8
Skills, hooks, MCP
Skills are router-only packs
4 Unify clients
8–10
IDE + lab on kernel
Lab is still a Python child
5 Eval
10–12
SWE slice on our loop
bench still calls mini-SWE-agent
6 After
12–20
Optional ast-grep; Verified smoke
—

### Phase 0 — Freeze and extract
Move loop.ts, tools.ts, registry.ts, types.ts into packages/spockify-harness. CLI thin REPL over runHarness. Golden fixtures: Ask turn, Agent turn with two tools, YOLO shell, tool fence. Publish event schema. Decision record: router never executes workspace tools. Exit: npm test harness + cli green. No feature work.
### Phase 1 — Control plane parity
Parallel tools in LLM order. LoopDetector. Replay protection. Kill registry: AbortSignal; bash process group SIGTERM then SIGKILL; TaskAgent cascade. JSONL atomic rename. Compact holds old file until new summary validates. TaskAgent types explore, bash, general; task tool stripped from children.
Exit tests that must exist: loop detect on 6 identical search hits; Ctrl+C during sleep 30 returns toolKilled and parent continues; killing task kills inner shell; compact failure leaves previous JSONL intact.
### Phase 2–5
Phase 2 ships the beat (cascade, READ_REQUIRED, grants). Phase 3 skills/hooks/MCP; napkin .spockify/napkin.md; no Wichy notebook.db. Phase 4: IDE and lab call runHarness; grep the repo for a second runAgentTurn. Phase 5: spockify bench swe uses @spockify/harness; lite --slice 0:1 --workers 1; one resolved Lite instance on gpt-oss-20b with our kernel beats a Heavy demo.
# 7.  Toolbelt and policy
Wave
Tools
Now (have)
read_file, write_file, edit_file, grep, glob, shell — upgrade implementations
Phase 1
task, todo, ask_user
Phase 2
apply_patch, checkpoint
Phase 3
codebase_search, list_skills, activate_skill, run_script, web_search, web_fetch via SearXNG
Later
browser_*, duckdb_* only if a lab workload demands them

Every tool: purpose, when to use, when not, one failure mode, one example. Fix the list_files-one-sentence vs bash-40-lines skew in Phase 0.
Policy field
Defaults
Notes
mode
ask | agent | yolo
Ask = read tools only
maxTurns
12 / 48 / 80
Hard cap 80
parallelTools
true
false via --seq-exec
loopWindow / loopThreshold
20 / 5
Wichy semantics
yoloGrants
none | session | all
YOLO is session grants, not no policy
writeRequiresRead
true
Off only in yolo + explicit flag
editCascade
true
Always on for agent/yolo
compactAtTokens
0 or N
Atomic swap only
thinking
off…heavy
Passed to transport; Heavy does not spawn coding workers
# 8.  Tests that decide the argument
If it is not in packages/spockify-harness/test, it does not exist. Router test_routing.py does not count.
loop.test.ts — turns, fence fallback, repair pass, maxTurns
parallel.test.ts — two tools, order preserved, one failure does not drop the other
loopDetect.test.ts — threshold, reset, disabled
kill.test.ts — sleep, hung node, task cascade, reused tool_call_id does not false-kill
editCascade.test.ts — trailing whitespace, anchors, refuse blind overwrite
writeGuard.test.ts — read then write ok; write alone fails
session.test.ts — crash mid-write leaves old JSONL; compact rollback
taskAgent.test.ts — no nested task tool; subset honored
permissions.test.ts — grant persists; revoke; Ask blocks shell
Phase 1 is failed if kill.test.ts is not written. Wichy’s last two days of commits were kill-registry deadlocks. That is the bar.
# 9.  Sequencing, risks, first week
One owner for @spockify/harness. CLI and IDE may not land loop changes outside it.
Router changes that execute a workspace tool are rejected.
Lab work blocked on Phase 1. Eval must not score mini-SWE-agent after Phase 5 starts.
Do not parallelize Cursor-clone UI against this as the same milestone.
Risk
Mitigation
Split-brain / lab-agents returns
Phase 4 exit grep; delete the wrapper
Router absorbs the loop
Decision record in Phase 0
YOLO as substitute for kill
Ship kill before YOLO marketing
Edit cascade hides model bugs
Always return the diff; never silent layer-4 write
Eval theater
No numbers without our kernel SHA
License sloppiness
NOTICE file; no paste of Wichy modules

### First week, in order
Create packages/spockify-harness from current loop/tools/registry. Export runHarness.
Point packages/spockify-cli at it. Delete the old files.
Write the four golden fixtures.
Add loopDetect.ts and kill.ts stubs with tests that fail, then implement.
Write docs/HARNESS.md: event schema, policy fields, router is not the agent.
Open tracking issues: cascade, edit layers, write guard, lab-on-kernel, bench-on-kernel.
That week does not include new IDE chrome, Heavy tweaks, or model catalog rows.
# 10.  How we know we beat Wichy
All of the following, together: one kernel imported by CLI, IDE, and lab; kill + cascade + loop detect + atomic compact with tests; edit cascade and write guard (items Wichy filed and did not ship); a SWE-Lite slice scored on that kernel with model and commit named; a human can interrupt a runaway shell from TUI and IDE and the agent continues.
Until then Wichy still wins the harness. Spockify can still win the product. Those are different trophies. This plan is only for the first one.
Sources: public trees of Spockify/spockify-oss and wiiha/wichy as of 17–18 Sep 2026; wichy ABOUT.md and notes/harness-improvement-suggestions.md; spockify loop.ts, tools.ts, labAgents.ts; services/router/parallel_agents.py; docs/BENCH.md.
