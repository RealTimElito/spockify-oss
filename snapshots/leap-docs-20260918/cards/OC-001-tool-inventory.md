# OC-001 — OpenCode tools vs Spockify lab/harness inventory

Date: 2026-09-18  
Sources: `Spockify_OpenCode_Parity_Leap.md`, `@spockify/harness`, `spockify-lab-agents`

| OpenCode-shaped tool | Spockify before | Spockify after OC window | Gap |
|---------------------|-----------------|--------------------------|-----|
| read (+ range) | `read_file` | `read` alias + start/end | closed |
| grep | `grep` | same | closed |
| glob | `glob_file_search` | `glob` alias | closed |
| apply_patch | lab SEARCH/REPLACE; CLI `edit_file`/`write_file` | harness `apply_patch` (reject unified diff) | closed in harness |
| bash | `shell` | `bash` alias + kill registry | closed |
| run_tests | pytest via shell / lab gates | `run_tests` + fail-object | closed |
| todowrite | none | `todowrite` | closed |
| git_snapshot / git_reset | lab `git_txn.py` | harness tools + TS helpers | closed |
| webfetch / task | IDE/MCP / Heavy SPAWN | deferred (not parity week-1) | open (later) |
| plan vs build | ask / agent | `--mode plan\|build`, `/plan` `/build` | closed |
| AGENTS.md /init | none | `/init` + `initAgentsMd` | closed |
| Session resume | CLI history only | JSONL session persist helpers | partial |

Lab orch/exec remains the state machine; harness is the OpenCode-shaped skin (`docs/HARNESS.md`).
