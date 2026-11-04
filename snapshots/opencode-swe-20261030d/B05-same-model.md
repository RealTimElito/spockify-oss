# B-05 same-model — sqlfluff__sqlfluff-1625 × gpt-oss-20b

| Side | Run | Outcome | Patch |
|------|-----|---------|-------|
| OpenCode 1.18.31 | `20261030` `--auto` | empty_patch | 0 B |
| OpenCode 1.18.31 | `20261030d` + instructions/`--dir` | **not-resolved** | nonempty (~493 B) |
| `@spockify/harness` | `20261030` / `20261030c` / `20261030d` | not-resolved | nonempty |

Config fix (real): OpenCode was calling fake tool `assistant`; pinned instructions + `--dir`. Still not a win claim. Historical pass@1=0 unchanged.
