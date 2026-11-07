SPOCKIFY LAB
Leap-forward plan
Harness, routing, models, measurement, and product — what to test, build, fine-tune, and refuse.
Status date  16 September 2026
Scope        Closed-loop coding agent + spockify-auto + local OSS models
Ambition     Stand on the same field as Claude Code, Cursor, OpenCode, Aider — honestly

This note is a working plan, not a claim that Spockify already beats anyone on SWE-bench, Terminal-Bench, or Aider polyglot. Those numbers do not exist yet. The overnight work (tips 50–87) proved the loop can stop. The next leap is to prove the loop can repair real repositories and that auto/orch pick the right model for the job.
How to use this document
Treat Phase 0–1 as non-negotiable. Do not start Phase 3 model work until Phase 1 has one checked-in SWE trajectory.
Every workstream has a kill criterion. If a stream fails its criterion, stop spending nights on it.
Public language is always model × harness × subset × date. Never a bare percentage.
Product defaults stay local OSS tags. Abliterated Devstral and dual-role aliases stay twin-only.
Keep rate/hello/docs/calc/rename as a 60-second smoke, not as the scoreboard.
1.  Where you actually are
What is proven
Two overnight trails (8 Sep tip 50, 15–16 Sep tips 51–87) ran almost entirely on local gpt-oss-20b. The oracle was local pytest and file-quality gates. Quality is a five-point lab rubric out of 10 (DONE format, no replan churn, correct stop, wall/rounds, no nested lab), not an industry pass@1.
The loop crossed from broken to healthy:

Best harness change: tip 50 exec-stream early-stop. Best later canary: Spark rate q10 ~8–11s. Best product smoke: mid-thought SPAWN merge. Those are real.
What is not proven
No SWE-bench Lite or Verified pass@1.
No Terminal-Bench.
No Aider polyglot.
No Spockify vs OpenCode / Claude Code / Cursor / Aider on a shared instance list.
No scored run of gpt-oss:120b, think=high, or abliterated Devstral on the coding loop.
No scored run of spockify-auto model choice (eval_board is a prompt arena, not repo repair).
Twin aarch64 blocked full SWE Docker; compose is dry-run/smoke only.
Lab-agents package is stripped from the public OSS export.
How to read “good or bad”
Good as a harness debug log. Weak as proof you are a peer of Claude Code or Cursor. You are in the right family of loops (plan → tools → verify → stop) and out of the naive-chat failure mode. You are not yet on their exam.
Assets you under-used
2.  North star and rules of the road
North star (12 months)
A stranger can clone the OSS tree, run a documented slice, and reproduce a card that looks like this:
2026-12-01  ·  SWE-bench Verified 0:50  ·  gpt-oss:120b  ·  think=high  ·  Spockify lab+mini-SWE  ·  pass@1 = X%  ·  median wall = Y min  ·  trajectories in bench-out/
Beside it, a second card for the same slice under OpenCode or Aider on the same open tag, or an explicit note that those harnesses would not host the tag. That is “alongside” on harness. Editor depth, Tab, and frontier APIs can still belong to Cursor and Claude Code.
Three tracks that must not be collapsed
Operating principles
One change per scored run. A new tip and a new default model in the same night teaches nothing.
Canaries never leave. lab_regress_quick on rate/hello/docs/calc/rename must stay green in ≤90s on 20b.
Hard evals live on twin or an x86 box with Docker. Not on prod Spark chat GPUs.
Product defaults: local Ollama tags only. No :cloud. No abliterated aliases on spark profile.
Do not fold Heavy (4-agent ensemble) into the coding harness. Do not start the leap with Tab/FIM rewrites.
Every trajectory is an artifact: prompt, picks, tools, diff, pytest, wall, tokens, think, model.
Publish only four-factor cards. Delete any sentence that says “Spockify 80%.”
Kill criteria (stop the stream)
SWE Lite 0:1 cannot complete a trajectory in 14 days of focused infra work → pause feature tips, buy or borrow amd64 Docker.
Always-20b beats auto on easy-bucket pass and is cheaper → auto ships behind a flag until regret is negative.
120b-high pass@1 on a 25-slice is within noise of 20b → do not advertise 120b as the coding default; spend on tools/oracle instead.
Abliterated Devstral wins only by ignoring product policy → keep private; never promote.
3.  Phased leap (90 days, then 6–12 months)
Phase 0 — Freeze and instrument  (days 1–3)
Goal: stop adding easy invent slugs; make the current loop measurable.
Tag the tree: harness-v50-87-freeze. Do not land tips 88–99 that only add LeetCode slugs.
Keep scripts/lab_regress_quick.sh as the merge gate. Fail CI (or a pre-push hook) if the five-task pack is red on 20b.
Add structured JSONL logging on every lab turn: {ts, tip, role, model, think, tools[], writes[], pytest, rounds, wall_s, tokens, stop_reason}.
Write packs/canary-v1.json listing rate, hello, docs, calc, rename with expected N passed.
Document host matrix: Spark (prod chat, no long SWE), twin (lab, aarch64), future amd64 SWE box.
Success: one command reproduces tip-61-class pack; logs exist for the next night.
Phase 1 — One real industry trajectory  (days 3–21)
Goal: the missing artifact from BENCH.md. This is the whole leap’s on-ramp.
Unblock Docker/Podman instance sandboxes. Prefer a small amd64 host over qemu-on-aarch64 if pull walls dominate. This is infrastructure, not a model problem.
spockify bench dry-run and smoke --model gpt-oss-20b until boring on compose and on twin LiteLLM.
spockify bench swe --subset lite --slice 0:1 --workers 1 --model gpt-oss-20b until one trajectory finishes and lands in bench-out/ (gitignored pattern, but keep a redacted summary in snapshots/).
Fix the mini-SWE template contract ({{task}} vs {{problem_statement}} already bit you). Pin mini-swe-agent version.
Only then retry the same instance on gpt-oss:120b think=low and think=high.
Success: a markdown card with instance id, models, pass/fail, wall, turns, failure mode. Failure: still only micros — then the month is infra, not agents.
Phase 2 — Closed-loop hardening to big-dog shape  (weeks 3–7, overlaps Phase 1)
Goal: make the write path look like Aider + SWE-agent, not like “model dumps a file.” Details in section 5.
Phase 3 — Model and think cards  (weeks 5–9)
Goal: 20b vs 120b vs Devstral vs think levels on a frozen 25-slice. Details in section 6.
Phase 4 — Router and orch choice  (weeks 6–10)
Goal: spockify-auto and lab orch graded on regret and escalation precision. Details in section 7.
Phase 5 — Public card + optional API harness isolate  (weeks 10–13)
Goal: publish the four-factor table; optionally run one strong API model through your loop vs Claude Code’s loop on the same slice if budget exists. Details in section 10.
Phase 6 — Product depth (only after Phase 1 is green)  (months 4–12)
Repo map / index that grep and open the right files.
Rules files and project memory that survive compacting.
Tab/FIM left on Codestral; do not drag it into the agent bench.
Composer / multi-file apply already has Keep/Undo — make it the only write path in the IDE.
Heavy ensemble stays a chat toy, not a coding default.
Week-by-week skeleton (first 12 weeks)
4.  What to test — the full matrix
Layer A — Canary (every commit)
Fixture family from the overnight: rate (TokenBucket), hello, docs (API.md completeness), calc, rename. Model frozen: gpt-oss-20b, think=low. Budget: ≤90s wall for the pack. Oracle: pytest N passed + file gates (docs ≥ ~700 B class, rename leaves no def old).
Also unit smokes you already have: lab unittest, mid-thought spawn 7/7, handoff. These catch chrome regressions, not coding skill.
Layer B — Internal hard micros (weekly, not nightly)
Promote shop, ledger, queue, cache, merge, package-nested, codec, DSU, BST, heap to a “floor pack.” These are still toys, but they are multi-file or invariant-heavy. Run on 20b and 120b-low. Record rounds-to-green and whether bootstrap was required. Noboot variants stay as stress tests; do not optimize the headline for bootstrap-on.
Layer C — Industry oracles (the leap)
Layer D — Router pack (new)
A frozen JSON pack (~80–120 items) with human oracle labels: family, smallest-passing-model, think floor, forbidden tags. Buckets: tiny regress, invent/multi-file, hard repair, Tab/FIM, chat/explain, product-safe (must not select abliterated). Metrics in section 7.
Layer E — Product / UX (smoke, not scores)
High SPAWN 3-worker merge.
IDE Keep/Undo, review bar, Ctrl+K Generating…
CLI /think cycle Off→Heavy and status.
Lab REPL Rk/N · phase.
Cap time: a short smoke list after deploys. Do not let a 404s SPAWN run stand in for pass@1.
Layer F — Reliability and safety
Open-fence / empty WRITE / reasoning-only stub still rejected.
Already-green preseed stops Round 1.
WRITE test_*.py blocked unless goal says so.
Prod profile cannot resolve lab dual-role or abliterated aliases.
Sandbox: no unexpected network; command allowlist on SWE instances.
Pass/fail language to use everywhere
pytest N passed / M failed — exact.
Rounds to first green.
Stop reason: early-stop, max-rounds, timeout, user, sandbox.
Quality /10 only on lab micros that still use the old rubric. Do not put /10 on SWE instances.
SWE: resolved / not resolved / infra-fail (image pull, OOM) as a third state. Infra-fails do not count as model fails.
5.  What to develop in the harness
5.1  The write path (highest leverage after measurement)
Big dogs do not let the model overwrite the repo as a short story. They apply a patch, reject junk, and reset.
One patch format. Unified diff or search-replace blocks — pick one, parse strictly, reject the other with a harness note (you already reject unified-diff WRITE bodies in places; finish the job).
Keep/Undo is the user-facing name of that patch transaction. The agent path must use the same applicator as the IDE review bar.
Git snapshot before the first WRITE of a job. On red oracle, reset. On green, leave a single commit or a stash the user can keep. Aider’s real edge is git as the transaction.
File budget: max N files touched unless the goal lists more. Scope-creep is how 10/10 toys become wrecked repos.
Never edit tests unless asked. You started this gate. Make it default on SWE.
5.2  The oracle path
Local pytest-in-cwd is the canary oracle. Industry work needs a container per instance: install, test command, hidden tests. Prefer Podman on twin; pin image digests when SWE-bench lets you. Log infra-fail separately from agent-fail.
Inject the last oracle result as a structured object every turn: {cmd, exit, tail, failed_nodeids[]}. Free-text “pytest failed” is how models invent new tests. You already nudge on ImportError/FAILED; make it schema, not prose.
5.3  Memory of the attempt
Durable todo list the orch cannot drop when it compact**s** history.
Last patch hunk + last fail object always in the exec prompt.
Cap auto-verify follow-ups (you set 2). After cap, one orch review, then stop — no 910s parens class.
Compact by dropping ls/cat/README, never by dropping asserts or fail tails.
5.4  Tools the model should have
Replace ls/cat thrash with: rg (or ripgrep-equivalent), targeted read with line ranges, apply_patch, run_tests, git_status/diff, maybe ast-grep later. Preseed should cat goal files once. Invent boots should not cat test_*.py when asserts are already in the prompt (tip 41 — keep).
5.5  Stop policy
You already have the important ones: stream early-stop on DONE+WRITE, brace/fence tracking, stub retry + think=low, already-green stop, post-WRITE pytest. Harden them into a state machine:

If the model emits DONE in exec during verify-needed goals, that is a harness bug, not a model bug. Tip 07 quality 0 was this class. Keep tests for it.
5.6  Role split
Orch plans and reviews. Exec patches and runs. lab-executor alias may stay twin-only. Do not let orch WRITE production files. Do not let exec invent a new plan mid-turn except via a typed “need-replan” signal. SPAWN is for user-visible parallel explores (Nest vs FastAPI vs chi), not for four silent critics on rate.py.
5.7  What not to develop yet
Heavy 4-agent ensemble as the coding default.
More invent slugs (hamming, plusone, fizzbuzz class). The overnight already proved R1 on those.
Tab/FIM architecture changes.
Cloud tags in product defaults.
Training a router model before the route pack exists.
6.  Models, think levels, fine-tuning
6.1  Default allocation
6.2  Ablations to run (once Layer C exists)
Same slice, same harness, one factor at a time:
20b think=low
120b think=low
120b think=high
120b think=high + escalate-from-20b (20b first, promote on red)
Private: Devstral stock vs abliterated, twin only
Report pass@1, median wall, median tokens, timeout rate, stub-reject rate. If think=high raises wall 3× and pass within noise, default think stays low and Heavy stays a user toggle.
6.3  When fine-tuning is rational — and when it is vanity
Fine-tune only after you have several hundred labeled traces of the format you actually want (JSON plan, apply_patch, no reasoning-only stubs). Overnight tips already teach format with harness gates. Those gates are cheaper than a LoRA.
If you still fine-tune, do it in this order:
SFT on exec: (fail-object + file excerpt) → legal patch. Not on chat essays.
SFT on orch: goal → one JSON plan object. Tip 08 already needed parse-first-JSON.
Do not SFT abliterated weights into the product default.
Do not RL / DPO until SFT format is stable and SWE Lite 0:10 exists as a holdout.
Preference data you already have: every tip that went q4→q10 is a pair (bad trace, good trace). Mine RESULTS.md and run logs before you scrape the internet.
6.4  Think-level policy to encode, not just toggle
User-facing /think is fine. Auto policy should be:
Canary and already-green: think=low or off.
First attempt on unknown SWE instance: think=low.
After one red verify with a real fail-object: think=high once.
SPAWN workers: moderate temp (you use 0.35 / Heavy 0.4); do not raise think and temp together.
Log the policy decision. That log is how you debug “why did auto burn 120b on hello.”
7.  Testing spockify-auto and lab orch choices
7.1  Split the two choosers
spockify-auto picks a model (and maybe think) for a user turn. Lab orch picks roles and whether to escalate inside a job. Grade them on different cards. Router eval_board stays the chat arena. make benchmark-router stays latency. Neither is the coding-router score.
7.2  Route pack v1
Hand-label once. Freeze. Version the pack. Fields per item: id, prompt or fixture, family, oracle_model, oracle_think, forbidden_models[], pass_rule.
Four policies on the same pack: always-20b, always-120b-high, spockify-auto, lab-orch-default.
7.3  Metrics that matter

Ship as spockify bench route --pack packs/route-v1.json. Print pick distribution. If auto cannot beat always-20b on easy pass and is more expensive, it stays flagged off for coding.
7.4  Orch assignment tests
Planning tokens go to orch; WRITE/RUN to exec.
Orch does not emit file bodies.
Need-replan is typed, not a second novel.
Bootstrap still skips orch LLM on first-turn pytest goals (tip 23). Ablate bootstrap on/off on the floor pack quarterly — do not silently depend on it for the SWE card.
SPAWN does not fire on single-file canaries.
8.  What to change, what to fine-tune, what to leave
Change now
Logging schema and canary CI.
SWE runner robustness (template, pinning, infra-fail taxonomy).
Patch applicator + git reset.
Fail-object in the prompt.
Host story for Docker images (amd64 or working qemu with honesty about slowness).
BENCHMARK_COMPARISON.md addendum template waiting for the first Lite 0:1 card.
Change next
Repo map / rg tools.
Route pack + auto regret.
Escalation policy 20b → 120b-high.
Verified 25-slice.
Same-slice OpenCode/Aider attempt.
Fine-tune later, maybe
Exec LoRA on apply_patch traces.
Orch LoRA on single-JSON plans.
Only after format gates are boring and you have holdout SWE items.
Leave alone for this leap
Tab/FIM / Codestral path.
Voice, XTTS, Comfy on-demand — product, not coding harness.
Open WebUI chrome except where spawn labels already shipped.
Heavy ensemble.
Public claims involving abliterated models.
Invent-battery expansion.
9.  Infra, hosts, and cost discipline
Host roles
Concurrency and hygiene
Workers 1, maybe 2. Do not wipe Ollama models between runs. Pin LiteLLM model ids. Cache Hugging Face datasets. Treat image pulls as a first-class wall, logged separately. Budget nights: one Lite instance 15–90 min; 25 Verified is a weekend if healthy, a week if the registry fights you.
Secrets and policy
Same auth as CLI (SPOCKIFY_API_KEY / LITELLM_MASTER_KEY / credentials.json). Bench talks to LiteLLM :4000 / :30400, not the router, for agent jobs — your BENCH.md already says this. Keep it. Router remains for chat routing.
10.  How to talk about results without lying
Allowed public sentences
“On internal regress micros with gpt-oss-20b, the loop reaches pytest-green in ~8–30s after early-stop work.”
“SWE-bench path is instrumented; first scored slice is DATE, model, N, pass@1.”
“We compare harnesses only on the same model tag.”
Forbidden public sentences
“Beats OpenCode / Cursor / Claude Code.”
“Spockify 80%.”
“Abliterated Devstral is our coding model.”
“Quality 10 means frontier coding skill.”
Card template (paste into BENCHMARK_COMPARISON.md)
Date / subset / N / model / think / harness / pass@1 / median wall / infra-fail rate / commit SHA / trajectory path. If a competitor row is missing, write “not run” or “harness refused tag” — not “N/A because we are better.”
11.  Risks, failure modes, and anti-patterns
You will be tempted to
Add tip 88–120 of easy invents because they go green and feel like velocity. That is the local maximum you already occupied on 15 Sep.
Turn 120b-high on for everything so walls look “serious.” That destroys the canary and hides harness bugs.
Publish eval_board arena wins as agent quality.
Fine-tune before you have SWE holdout.
Call SPAWN a multi-agent coding system.
Use abliterated weights in a blog diagram.
Technical failure modes already seen — keep regression tests
12.  Working cadence and definition of done
Cadence
Daily: canary pack on 20b if you touched loop.py / shell_tool / llm / router.
Twice weekly: floor pack (shop/ledger/queue).
Weekly: one SWE instance or slice increment, plus a written failure-mode note.
Every tag: four-factor card or an explicit “no score this tag.”
Optional bounded burn: LEAP-LOOP-48H — the same canary/trace/SWE-one-at-a-time cycle for 48 hours, then a closeout pack. Details in the agent playbook section 14. Not an unbounded overnight.
Definition of done for the leap
You are done with the 90-day leap when all of the following are true:
Canary pack is a merge gate.
At least one SWE Lite instance has a complete trajectory checked in as a summary.
A frozen slice (Lite 10 or Verified 25) has a 20b and a 120b-high row.
Git reset on red works in the lab loop.
spockify bench route produces a regret table, even if auto loses.
BENCHMARK_COMPARISON.md has an addendum with numbers, not only methodology.
You are not done when invent R1 count goes up, when SPAWN looks like Cursor, or when the model list on the twin looks expensive.
If you only do five things
JSONL traces + canary CI.
SWE Lite 0:1 completed.
Patch + git reset.
20b vs 120b-high on a frozen slice.
Route-pack regret vs always-20b.
13.  Appendix — source of truth and existing numbers
Documents this plan assumes
docs/BENCH.md — how to run dry-run / smoke / SWE; estimates only.
docs/BENCHMARK_COMPARISON.md — methodology; explicit non-claims.
snapshots/overnight-20260908/{SUMMARY,RESULTS}.md — tip 23–50 walls and /10 scores.
snapshots/overnight-20260915/{SUMMARY,RESULTS}.md — tips 51–87, rounds, N passed.
scripts/run-swebench.sh and scripts/bench/ — industry path.
scripts/lab_regress_quick.sh — canary.
packages/spockify-lab-agents/ — private loop (not in public OSS export).
Compressed overnight scoreboard (do not over-read)

Quality 10 means the lab rubric passed on a fixture. Worst recorded qualities were 0 (false-stop), 3 (no WRITE / bad JSON), 4 (undo-after-fix), 5 (invent/parens thrash). End-state kept evals are 10s with short walls. That is the floor to protect, not the ceiling to advertise.
Closing
The sky is not “more models on the twin.” The sky is a stranger reproducing a four-factor card, a loop that patches and resets like a grown agent, and an auto router that spends 120b only when 20b has already lost. Everything in this plan either produces that card, protects the canary that keeps you from lying to yourself, or is marked later. If a night of work does none of the three, it is not a leap.

### TABLE 1

| One-sentence strategy Freeze the toy canaries, stand up a real SWE/Terminal scoreboard on gpt-oss:120b with think ablations, make git+sandbox+patch the only write path, grade spockify-auto on routing regret, and do not fine-tune or ensemble until those cards exist. |

### TABLE 2

| Signal | Before | After (kept) |
| Rate canary | ~293s DONE-loop / q3–q5 class | q10, ~8–16s, often Round 1, 3 passed |
| Calc / shop / docs | minutes; quality 3–4 | q10, ~6–20s |
| Rename | ~117s orch | ~16s bootstrap |
| Invent slugs | noboot 100–240s; parens q5 ~910s | mostly R1 green in 20–35s |
| Five-task pack (tip 61) | did not exist | rate+hello+docs+calc+rename OK ~63s |
| SPAWN UX | missing chrome | 3 workers merge, ~404s smoke |

### TABLE 3

| Asset | Role it should play | Role it played overnight |
| gpt-oss-20b | Harness canary, easy-bucket default | Almost the entire scoreboard |
| gpt-oss:120b + think=high | Hard-bucket workhorse | Available, not scored |
| Codestral | Tab/FIM only | Left alone (correct) |
| Abliterated Devstral / dual-role | Private A/B on twin | Policy: not prod; not scored |
| spockify-auto router | Family + size + think picker | Not graded on regret |
| Lab orch/exec | Role split + escalate-on-red | Fixed model, changing gates |
| mini-SWE-agent path | Industry-shaped oracle | Instrumented, not scored |
| IDE Keep/Undo, HUD, /think | Product surface | Shipped; not the gap |

### TABLE 4

| Track | Question | Forbidden collapse |
| Harness | Does the loop patch, sandbox, verify, reset? | Do not credit invent R1 as SWE skill |
| Model | Do 120b / Devstral / think=high raise pass? | Do not hide a loop bug behind bigger weights |
| Router | Does auto pick the cheapest model that still passes? | Do not use eval_board win-rate as coding-router quality |

### TABLE 5

| Week | Focus | Exit artifact |
| 1 | Freeze, JSONL logs, canary pack CI | canary-v1 green on 20b |
| 2 | Docker/Podman on twin or amd64; smoke | smoke boring |
| 3 | SWE Lite 0:1 on 20b | one trajectory in bench-out |
| 4 | Same instance on 120b ± think | 3-row instance card |
| 5 | Patch format + git snapshot/reset | red pytest → clean tree |
| 6 | Lite slice 0:10 | 10-instance table |
| 7 | Sandbox allowlist + fail-object memory | structured last-fail every turn |
| 8 | Route pack v1 + always-20b baseline | regret table |
| 9 | Devstral private A/B (twin only) | private memo, not a blog |
| 10 | Verified slice 0:25 if Lite is sane | 25-row card |
| 11 | OpenCode or Aider same-slice attempt | harness delta or documented refusal |
| 12 | Publish addendum in BENCHMARK_COMPARISON.md | four-factor table live |

### TABLE 6

| Suite | Start | Then | Do not |
| SWE-bench Lite | slice 0:1, then 0:10 | 0:25 on 120b | Full ~300 until twin/amd64 is proven |
| SWE-bench Verified | slice 0:5 after Lite 0:10 is stable | 0:25, maybe 0:50 | Claim a % on N<25 |
| Terminal-Bench 2.0 | After first Verified 25 | small slice | Start here |
| Aider polyglot | Only if you grow an Aider-like edit driver | optional third board | Force-fit invent slugs |

### TABLE 7

| State | Allowed actions | Exit |
| plan | orch JSON only | tasks[] or DONE inspect |
| exec | patch / allowed RUN | writes_ok or stub-reject |
| verify | pytest / instance tests | green → done; red → fail-object |
| repair | one scoped patch | back to verify; cap 2 |
| done | none | status=done |
| abort | reset git | timeout, max-rounds, sandbox |

### TABLE 8

| Tag | Product default? | Eval role |
| gpt-oss-20b | Yes — easy + canary | Always-on baseline; harness regressions |
| gpt-oss:120b think=low | Optional coding | Hard micros; SWE Lite first pass |
| gpt-oss:120b think=high | Opt-in /think Heavy | SWE Verified card; escalation target |
| Codestral | Tab only | bench-tab-model.py only |
| lab-executor / dual-role | No (twin) | Private role-split A/B |
| Abliterated Devstral | No (twin) | Private pass@1 vs stock coder |
| :cloud / Opus / GPT-API | No product default | Optional Phase 5 harness isolate |

### TABLE 9

| Metric | Meaning | Good looks like |
| Family accuracy | Did auto pick chat vs code vs tab vs repair? | >90% on v1 pack |
| Pass@1 by bucket | Did the chosen stack solve it? | Easy ≈ always-20b; hard ≈ always-120b |
| Regret (wall or tokens) | Cost minus oracle cost, given pass | Near zero on easy; small on hard |
| Escalation precision | Of 120b/Devstral picks, share 20b would fail | High — no vanity upgrades |
| Escalation recall | Of 20b failures, share that got escalated | High — no silent give-ups |
| Policy violations | Abliterated or :cloud on spark profile | Zero |

### TABLE 10

| Host | Allowed jobs | Forbidden |
| Spark / prod | Chat, SPAWN smoke, short canaries | SWE days, Docker storms, wiping Ollama mid-run |
| Twin lab | 120b, Devstral A/B, lab aliases, longer walls | Becoming the public chat GPU |
| amd64 SWE box (get one) | Instance images, Lite/Verified | Interactive playground |
| OSS compose CPU | dry-run, docs, unit tests | Pretending it is a coding GPU |

### TABLE 11

| Mode | Historical tip | Permanent test |
| Orch skips exec / hallucinated inspect | 01 quality ~0 | Force findings from shell observations |
| Fix then undo after DONE | 06 q4 | Review skips when pytest_passed |
| Multi-JSON false-stop | 07 q0 | parse first JSON only |
| WRITE after DONE / bad fence | 09–10 q3–4 | salvage + fence extract |
| Shop timeout 400s | 13 | serialize edits; timeout taxonomy |
| DONE-loop ~293s | 49–50 | stream early-stop |
| Reasoning-only stub | 52 red pytest | stub-retry + think=low |
| Already-green 3-round thrash | 57–58 | preseed N passed → stop R1 |
| ModuleNotFound stub | 65 | force WRITE of missing module |

### TABLE 12

| Item | Score / result | Wall |
| Tip 50 rate | q10 | ~16s (was ~293s) |
| Tip 50 anagrams / docs / DSU | q10 | ~9s / ~11s / ~22s |
| Tip 53 Spark rate | q10, pytest green | ~9.4s |
| Tip 58 already-green | stop R1 | ~7s |
| Tip 59 Spark rate | R1, 3 passed | ~8s |
| Tip 61 five-task pack | all OK | ~63s |
| Tip 62 minstack | R1 green | ~35s |
| Tip 65 LRU | R1 green | ~28s |
| Tip 75 / 87 Spark rate | R1 | ~11s band |
| SPAWN High, 3 workers | merge OK | ~404s |
| SWE Verified pass@1 | not run | — |