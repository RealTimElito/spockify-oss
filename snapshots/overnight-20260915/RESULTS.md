# RESULTS — overnight-20260915

## SPAWN smoke (prod Spark, after `midthought-202609152247`)

- Prompt: NestJS vs FastAPI vs Go chi, High thinking, parallel research
- Agent run `b8903efd1f1446b0`: profile=`midthought`, status=`done`, 3 workers
  - nestjs_research / gpt-oss-20b
  - fastapi_research / gemma4-12b
  - go_chi_research / gemma4-12b
- Client: agents SSE events present; content_len≈2821; think_len≈3328; wall≈404s
- Artifact: `01-prod-midthought-comfy/spawn-smoke.json`

## Temps / caps (SPAWN path)
- `MIDTHOUGHT_WORKER_TEMP` default **0.35** (Heavy stays 0.4)
- `MIDTHOUGHT_SPAWN_MIN_PROMPT` **40** chars + ≥6 words
- Cap Spark **3** / compose **2**; max 1 spawn round

## Before → after (prod)
| | Before tonight | After |
|--|----------------|-------|
| Router tag | midthought-202609082212 | midthought-202609152247 |
| OWUI tag | spawn-label-202609082015 | spawn-label-202609152256 |
| Comfy | deploy scaled 0, no gateway | gateway 1 + backend svc + wake |

## Tip 51 orch early-stop (Spark careful micro)

- Fix: require **balanced braces** + non-empty task instructions before stop (truncated JSON caused false stop in tip51a).
- tip51b wall ~**27s** (plan **7.6s** → exec → handoff); orch stop no longer cuts mid-JSON.
- Models: orch/exec `gpt-oss-20b` via Spark LiteLLM PF (twin down; no lab-* aliases).

## Tip 52 — exec open-fence gate (unit green; Spark micro soft)

- `exec_stream_should_stop` refuses open ``` fences + empty WRITE bodies
- Cursor HUD: Ctrl+K Generating…; CLI `spockify_agents` spinner; chat Keep/Undo hint
- Spark rate micro (`micro-spark-tip52.txt`): gpt-oss-20b returned reasoning-only stubs (“We need”) — pytest still red; tip 53 targets stub salvage/retry

## Tip 53 — stub-retry + think=low (BEST tonight for harness)

- Rejects reasoning-only stubs; one nudge retry; `think=low` for orch/exec
- Spark rate micro: **q10 ~9.4s** (WRITE + auto pytest + early-stop); tip52 was soft

## Tip 54–55 — docs gate + nested WRITE (compose careful)

- Tip 54: `docs_write_quality_note` nudges truncated API.md; blocks premature early-stop
- Tip 55: balanced-fence WRITE extract + `line.WRITE:` normalize
- Compose docs (`micro-compose-tip54d-docs.txt`): **~18s**, API.md **711 bytes**, greet+add
- Compose rate regression: **~16s**, **3 passed**

## Tip 54 micro (Spark, post tip-53)

- hello inspect: plan+exec **~5.4s**, review skip done (HELLO_EXIT=0)
- docs API.md: bootstrap WRITE **~5.3s**, API.md on disk (DOCS_EXIT=0)
- Prod deploys still 1/1 (router/OWUI/gateway/XTTS)

## Tip 54–55 harness + IDE

- pytest-fail nudge (ImportError/collect + FAILED) + cap tool rounds after nudge+WRITE
- `exec_stream_should_stop(pytest_goal=True)` waits for pytest RUN before early-stop
- IDE: review phase bar count + Wrapping up on streamDone
- `scripts/lab_regress_quick.sh` for rate/hello/docs


## Tip 56 — lab REPL round chrome
- Tee harness stdout; parse Round banners into live `Rk/N · phase` status
- Turn header + done footer with wall time

## Tip 57 — nested-fence early-stop
- WRITE outer-fence tracking so nested ```python does not early-stop mid-docs

## Tip 58 — preseed/auto pytest green (BEST for already-green thrash)
- Preseed `N passed` → pytest_passed; DONE without RUN → auto verify once
- Compose already-green: **~7s**, stop Round 1 (was tip57 Spark 3-round thrash)


## Tip 59 — double stub nudge + lab VSIX
- Two stub retries; second forces WRITE when preseed pytest failed
- Spark rate: **~8s** Round 1, 3 passed (`micro-spark-tip59-rate.txt`)
- Lab VSIX: `spockify-0.9.17-lab.vsix` 1.3 MB via pack-spockify-lab-vsix.sh


## Tip 60 — rename completeness + calc/invent
- Nudge when rename leaves `def old` / old imports
- calc ~6s 2 passed; invent slug ~16s 2 passed; rename tip60b completes both files

## Tip 61 — expanded regress
- rate/hello/docs/calc/rename all OK · compose ~63s

## Tip 62 — WRITE sanitize + minstack
- Strip observation junk from WRITE bodies
- minstack tip62b ~35s Round 1 green

## Tip 63 — heap + anagrams invent
- both Round 1 green on compose

## Tip 64 — invent battery
- lru R4, bst R2, parens R1 all pytest green
- CLI wrapping-up spinner on done

## Tip 65 — ModuleNotFound stub force
- LRU tip65b ~28s Round 1 green

## Tip 66 — codec/flatten/roman
- all Round 1 green; tip66 regress OK

## Tip 67 — dsu/merge/queue
- all Round 1 green (queue tip67b)

## Tip 68 — topo/ledger + Spark rate
- topo/ledger Round 1; Spark rate tip68c ~18s

## Tip 69 — rpn/is_anagram + CLI docs
- both Round 1 green; README /think

## Tip 70 — twosum/binsearch + regress
- tip70 regress OK; both invents Round 1

## Tip 71 — classic invents
- fib/palindrome/majority/climb all Round 1 green

## Tip 72–73 — invents + post-batch pytest
- tip72 maxsub/missing/reverse green; tip73 validbst + post-batch gate

## Tip 74 — bit/array invents + Spark
- 4 invents Round 1; Spark rate Round 2

## Tip 75 — easy invents + Spark rate
- 4 invents Round 1; Spark rate Round 1 ~11s

## Tip 76 — base-url /v1 strip
- resolve_base_url strips trailing /v1; unit tests green

## Tip 77 — array/string invents
- 4 invents Round 1; tip76 /v1 path live-confirmed

## Tip 78 — array easy invents
- 4 invents Round 1 on Spark PF

## Tip 79–80 — invent+regress + PF port
- 4 invents Round 1; regress all OK; script default :24001

## Tip 81–82 — string maps + lab /think
- 4 invents Round 1; lab REPL /think wires harness env

## Tip 83 — classic invents
- anagram/uniq/prefix Round 1; roman Round 3

## Tip 84 — tree/list invents
- 4 invents Round 1

## Tip 85 — bits/math + regress
- invents green; regress all OK

## Tip 86 — math/games + VSIX
- 4 invents Round 1; VSIX 1.3 MB refreshed

## Tip 87 — final invents + Spark rate
- 4 invents green; Spark rate Round 1; overnight STOP ~07:00
