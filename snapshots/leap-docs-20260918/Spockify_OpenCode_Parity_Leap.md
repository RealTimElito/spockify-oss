SPOCKIFY LAB
OpenCode-parity leap
Close the gap with sst/opencode on the coding-agent axis: same exam, same tool shape, scored slice. Companion to Spockify_Leap_Forward_Plan.docx and the agent playbook. This note wins if a stranger can run one frozen SWE slice on gpt-oss:120b under Spockify and under OpenCode and read both pass@1s.
Parity definition (what “on par” is allowed to mean)
On-par does not mean 208k GitHub stars, 75 cloud providers, or OpenCode Zen. It means: (1) a user can cd into a repo and run a Spockify agent that plans, patches, shells, and verifies; (2) on a frozen SWE-bench Lite or Verified slice, Spockify × gpt-oss:120b is within a small band of OpenCode × the same tag — or you publish the delta and the failure modes. Anything else is branding.
# 1.  The gap, stripped of marketing
OpenCode is a drop-in agent for a git working tree. Spockify is an appliance that also contains an agent. People compare the agents. The appliance extras (OWUI, SPAWN, Comfy, XTTS) do not count on this leap.
Gap
OpenCode today
Spockify today
Parity move
Time-to-agent
opencode in a repo
compose + lab + model tags
spockify agent cwd CLI that needs only LiteLLM
Tools
read/write/edit, grep, glob, bash, apply_patch, webfetch, todowrite, task
WRITE/RUN, cat/ls thrash, pytest gates
grep/glob/read-range/apply_patch/run_tests
Modes
plan vs build (Tab)
orch vs exec, /think
explicit plan-readonly vs build
Project memory
AGENTS.md from /init
none standard
AGENTS.md or .spockify/AGENT.md
Git transaction
snapshots / undo culture
Keep/Undo UX; reset not default
snapshot before first WRITE; reset on red
SWE evidence
third-party cards (e.g. Opus 4.8 OpenCode 83.4% Verified vs CC 86.8%)
zero scored instances
Lite 0:1 then same-slice vs OpenCode
Providers
75+ + Zen
local OSS policy
keep local default; optional OpenAI-compat
Distribution
~208k stars
homelab
ignore stars; ship CLI

Red Hat’s bench is the shape of the scoreboard you want to join: model × harness × subset × cost. You cannot borrow their Opus numbers. You can copy the table structure with gpt-oss:120b.
# 2.  What we will not copy
Star count, Twitter, or “7.5 million developers.”
OpenCode Zen as a hosted model store. Your product is local-first.
75 providers on day one. One OpenAI-compatible path (LiteLLM) is enough.
Desktop Tauri app. You already have Code-OSS + CLI.
Invent slugs as a substitute for SWE.
Heavy ensemble as the OpenCode clone.
Claiming parity before the same-slice card exists.
# 3.  Target architecture (OpenCode-shaped, Spockify-hosted)
User mental model to match: cd repo && spockify agent. The agent talks to LiteLLM, not the chat router. OWUI is not in the path.
### Process
spockify agent [--model gpt-oss-20b|gpt-oss:120b] [--think low|high] [--mode plan|build]
Loads AGENTS.md / .spockify/AGENT.md if present; else offers /init.
Plan mode: read, grep, glob, bash-readonly. No WRITE.
Build mode: apply_patch, run_tests, bash allowlist, git snapshot.
Stop on green oracle or abort + reset.
### Tool set to implement (freeze names)
Tool
Must behave like
Notes
read
path + optional start/end lines
kill unbounded cat
grep
rg semantics
content search
glob
fnmatch over tree
file find
apply_patch
one legal patch format
reject raw dumps
bash
cwd sandbox, timeout
allowlist on SWE
run_tests
pytest or instance cmd
returns fail-object
todowrite
durable task list
survives compact
git_snapshot / git_reset
txn
Aider/OpenCode undo class

Map existing lab orch/exec onto plan/build. Do not run two loops. The lab state machine (plan→exec→verify→repair→done) stays; the CLI is the OpenCode-shaped skin.
# 4.  Measurement leap (this is the parity gate)
Phase OC-M0: canary still green on 20b (rate/hello/docs/calc/rename ≤90s).
Phase OC-M1: one SWE Lite instance via existing mini-SWE path OR via the new agent CLI, whichever finishes first. Classify resolved / not / infra-fail.
Phase OC-M2: freeze slice S (Lite 0:10, then Verified 0:25 when host allows).
Phase OC-M3: same S, same model tag, two harnesses:
Row
Harness
Model
Output
A
Spockify agent
gpt-oss-20b think=low
pass@1, wall, infra-fail
B
Spockify agent
gpt-oss:120b think=high
pass@1, wall
C
OpenCode build agent
same 120b tag if it hosts it
pass@1, wall
D
OpenCode + frontier API (optional)
e.g. whatever Zen/default
document model asymmetry

Parity rule: if |pass_B − pass_C| ≤ 5 points on N≥10 and infra-fail <20%, you may say “competitive on this slice with this tag.” If OpenCode refuses the local tag, publish B alone and write “OpenCode row not run — provider.” Never fill C with a foreign Opus %.
Host: not prod Spark. Twin or amd64 Docker box. Workers=1.
# 5.  Build sequence (90 days)
Week
Ship
Done when
1
spockify agent --mode plan on a fixture repo
reads/greps, cannot write
2
apply_patch + git snapshot/reset
red pytest restores tree
3
run_tests fail-object + todowrite
repair sees last fail schema
4
AGENTS.md /init + plan/build toggle
matches OpenCode user ritual
5
SWE Lite 0:1 on 20b
trajectory folder
6
Same instance on 120b ± think
3-row instance card
7–8
Lite 0:10 both harnesses if possible
table in BENCHMARK_COMPARISON
9–10
Sandbox allowlist + file budget
canary still green
11–12
Verified 0:25 or honest stop
four-factor addendum

Optional 48h loop from the playbook may burn canaries + one-at-a-time SWE during weeks 5–8. It must not add slugs.
# 6.  Agents for this leap (narrower than the full playbook)
Owner
OpenCode-parity job
A0 Director
Accept only cards with model×harness×slice
A1 Canary
Block any tool-set PR that breaks 20b pack
A3 Infra
Docker so OpenCode and Spockify can both run instances
A4 SWE + OC runner
Drive both harnesses on slice S
A5 Loop
Expose plan/build; stop cat/ls as primary tools
A6 Patch/Git
apply_patch is the only write
A7 Oracle
run_tests matches mini-SWE and local pytest
A11 Auditor
No “beats OpenCode” without row C or an explicit missing-row
A13 Competitor
Install OpenCode next to Spockify; same cwd, same tag

A9 router is secondary here. OpenCode parity is the agent loop, not auto picking Devstral. A15 only glues Keep/Undo to apply_patch.
# 7.  Product UX to steal (small list)
cd repo; one command; TUI or CLI session log with tool names visible.
/init writes AGENTS.md (stack, test cmd, conventions).
Tab or flag toggles plan vs build.
Permission on destructive bash in plan mode; build mode still sandboxed on SWE.
Session resume. OpenCode users expect the agent to come back.
Do not spend the quarter on spawn chips or Generating… copy. That race is Cursor chrome, not OpenCode.
# 8.  Models
Canary: gpt-oss-20b think=low. Parity card: gpt-oss:120b think=high. Escalation: 20b first, 120b on first real fail-object. Abliterated Devstral: private twin A/B only. If you add a cloud tag solely to match OpenCode’s Opus row, label it harness-isolate and keep it off product defaults.
Think policy like OpenCode plan/build, not like a vanity Heavy switch: plan stays low; build may high once after red verify.
# 9.  First tickets
OC-001 Inventory OpenCode tools vs lab tools; gap list in TICKETS.md.
OC-002 apply_patch chosen format + reject-other tests.
OC-003 git_snapshot / git_reset.
OC-004 grep + glob + read-range replace cat/ls defaults.
OC-005 spockify agent CLI plan mode on a fixture.
OC-006 build mode + run_tests fail-object.
OC-007 /init → AGENTS.md.
OC-008 Install OpenCode on the SWE host; smoke one instance.
OC-009 SWE Lite 0:1 Spockify 20b.
OC-010 Same instance OpenCode + same local tag (or documented refusal).
OC-011 Slice S frozen; both harnesses; addendum table.
# 10.  Kill switches
Canary red after a tool PR → revert before more OpenCode cloning.
Cannot complete Lite 0:1 in 21 days → leap becomes infra, not prompts.
OpenCode cannot host gpt-oss:120b → still publish Spockify row; do not fake C.
120b pass ≈ 20b on S → do not market 120b as the OpenCode-killer.
Anyone writes “on par with OpenCode” before OC-011 → A11 blocks.
# 11.  How you will know you got there
Minimum bar (honest “in the same league on local weights”):
spockify agent works in a random git repo without compose theatre beyond LiteLLM.
Plan/build + AGENTS.md + apply_patch + reset-on-red.
Slice S card with rows A/B and C-or-explicit-missing.
Delta explained by failure-mode notes, not vibes.
Stretch bar (actually on par): |B−C| small on N≥25 Verified, infra-fail low, and a stranger reproduces from BENCH.md.
You will not match OpenCode’s community or its Opus numbers this quarter. You can match its shape and enter its scoreboard class. That is the leap.
## Public sentence allowed after OC-011
“On DATE we ran SWE subset S with gpt-oss:120b through Spockify and through OpenCode. Pass@1 was X vs Y. Trajectories in bench-out/. Infra-fails listed separately.”
Everything else waits.
# 12.  Appendix — serving knobs (A3, SWE host only)
Not parity
These knobs do not make Spockify an OpenCode-class agent. They only matter after OC-008/009 exist and a profiled 120b trace shows VRAM, TTFT, or tok/s as the bottleneck. Change one knob per scored night. Workers stay 1 on SWE.
Own this as A3 Infra tickets OC-INFRA-01…, not as A5 loop work. Profile first: one gpt-oss:120b think=high request — TTFT, tok/s, VRAM used, context tokens actually consumed, engine name (vLLM / SGLang / Ollama). Write numbers in loop48-state or cards/serving-baseline.md.
Knob
Do
Do not
FP8 KV cache
Try --kv-cache-dtype fp8 (or engine equivalent) on the SWE host if the server supports it; log VRAM before/after and canary + one instance quality
Claim 50% savings without a measurement; do not enable if quality on 120b-high drops
max-num-seqs
Leave low on the eval box (1–2). Raise only on Spark chat/SPAWN if queueing is the pain
Set 1.5–2× a “developer cohort” on the SWE worker; that fights workers=1
max-model-len
Default 32,768 for chat. Allow 64k–128k per SWE job when the instance needs it
Hard-cap 16,384 in production eval — multi-file repair dies
Host CPU
Start at ~4 physical cores per GPU worker if tokenize/detok shows up in profiles
Treat 4 as a law; measure steal time
Confidential Computing
If the eval runtime is actually in CC, run that host No-CC and measure TTFT/tok/s
Advertise 45%+ if CC was never on; do not silently drop CC on a security-sensitive prod path

OC-INFRA-01 Serving baseline on SWE host (engine, VRAM, TTFT, tok/s, context used).
OC-INFRA-02 One-knob FP8 KV trial vs baseline; canary stamp required.
OC-INFRA-03 Context policy: 32k default, per-job raise for SWE; document in BENCH.md.
OC-INFRA-04 Confirm whether CC is enabled; No-CC only if yes and only on eval box.
Kernel dependency: after @spockify/harness Phase 5, OC-009+ must call runHarness, not mini-SWE-agent. See Spockify_Wichy_Harness_Plan.docx. Until that extract exists, Lite 0:1 may use the current path only as a host smoke, not as the published harness row.
Strip brochure language from any public note. Allowed: “On HOST, engine E, FP8 KV reduced VRAM from A to B GiB; canary still green; Lite 0:1 outcome unchanged|changed.”
