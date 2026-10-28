# G1 policy & isolation review (operator-signed; not a pentest)

**Sign-off:** Tim (operator) waived G1-09 on 2026-10-17. That is an operator
production waiver, not a penetration test and not an external human review.
Date of latest pass: 2026-10-17.

Reviewers recorded here:

| Who | What | When |
|-----|------|------|
| Implementing agent (isolation increment) | Source review of `isolate.ts`, `job.ts`, `kill.ts` spawn path, production-profile checks | 2026-10-17 |
| Internal Cursor security-review pass | Looked at the **wrong diff** (uncommitted video catalog + overnight snapshots) while in Ask mode; did not update this file. Added G1-13 / G1-14 in a later implementing-agent edit. Not independent. | 2026-10-17 |
| Independent agent review (prior pass) | Isolation increment only. Agent mode. Re-verified G1-03–G1-14. Cheap jail fixes landed in that commit. **Not a human or pentest.** | 2026-10-17 |
| Implementing agent (this pass) | Closed implementable residuals: bwrap seccomp (G1-05), host isolation.env (G1-13), ask-class SPAWN_CODING broker (G1-14), cheap G1-04/06/11. **Not a human or pentest.** | 2026-10-17 |

**G1-09 is operator-waived (Tim, 2026-10-17).** An agent re-read of the right
files is still only an in-tree *record*. Do not describe this as a pentest.

Scope: coding-agent kernel, Compose production-profile checks, isolated runner.
Out of scope: live cluster ingress, GPU schedulers, product chat UI, video catalog, overnight snapshots.

## Findings

| ID | Severity | Status | Finding |
|----|----------|--------|---------|
| G1-01 | High (was) | Fixed in tree | bubblewrap inherited the host environment. `SSH_AUTH_SOCK`, `DOCKER_HOST`, and `*_TOKEN` / `*_SECRET` keys could enter the jail. Fix: `--clearenv` plus a small `PATH`/`HOME`/`LANG`/`SPOCKIFY_JOB_ID` set; `sanitizeIsolateEnv` on isolated spawns (`spawnBashGroup`). Re-verified: `--clearenv` is still in `bwrapArgv`; live test still asserts empty `SSH_AUTH_SOCK`. |
| G1-02 | Medium | Fixed in tree | `SPOCKIFY_ISOLATED_RUNNER=bwrap` fell through to podman if bubblewrap was missing. Explicit backend still fails closed. Generic `1`/`true` or production-without-explicit still prefers bwrap then podman then error — never host bash. Re-verified; added explicit-podman-no-bwrap-fallback test. |
| G1-03 | Medium | Tightened | Shell classification (`classifyBash`) remains a regex heuristic (plan SEC-04). Isolation is the enforcement boundary, not the regex. This pass closed proven auto-class holes: `git push`/`reset`/`clean`/`rebase` and `npm publish` are ask (SPAWN_CODING already blocks ask/deny); path-prefixed / flag-split `rm -rf /` is deny (`/bin/rm`, `-fr`, `-r -f`). `git status`/`diff` and `make test` stay auto. Not a bash parser. |
| G1-04 | Medium | Tightened | Minimal `/dev` (`tmpfs` + `null`/`zero`/`urandom`/`random` + fd symlinks; no `--dev /dev` ptmx/tty set) and an `/etc` allowlist (`passwd`/`group`/`nsswitch`/`ld.so`/`ssl`/…). Residual: host device *nodes* are bound (not a full LSM device whitelist). Fine for a single-tenant workstation jail. |
| G1-05 | Medium | Fixed this pass | bwrap applies a real `--seccomp FD` deny-list BPF (`seccomp.ts`; ptrace/mount/unshare/bpf/kexec/…). Production fail-closed if the filter cannot be encoded, written, or inherited. `SPOCKIFY_BWRAP_SECCOMP=0` is a hard error under `SPOCKIFY_PRODUCTION`. Podman still uses the runtime default + `no-new-privileges`. Not a published sandbox profile. |
| G1-06 | Low | Tightened | Known workspace socket names (`docker.sock` / `podman.sock` / `containerd.sock` / `cri-dockerd.sock` at cwd and a few desktop paths) are overlaid with `/dev/null`. Other unix sockets in the tree remain reachable. Operators should still not put engine sockets in the project. Bind sources that *are* `/run`, `/var/run`, or the docker/podman runtime dirs still fail closed. |
| G1-07 | Low | Open | Job store is a local JSON directory with a concurrency cap and an exclusive admit lock. It is not an authenticated control plane, not multi-tenant, and not a substitute for Postgres job metadata at R2. Left as a local store on purpose. |
| G1-08 | Info | Accepted | `hostPrivileged` grant/revoke is the CLI/IDE controller. A compromised host process is the controller. The model cannot call `grant`. |
| G1-09 | High | Operator-waived | No independent penetration test or external human reviewer. **Tim (operator) waived this gate on 2026-10-17** so operator production can proceed. Not a pentest. Not a fake signature. |
| G1-10 | Low | Fixed this pass | Audit JSONL redacts secret-shaped *keys* and secret-shaped *values* in `reason` (`sk-` / `Bearer` / `ghp_` / `github_pat_` / key-named strings). Static reject reasons are unchanged. |
| G1-11 | Low | Tightened | `sanitizeIsolateEnv` is still a blacklist (now also `DOCKER_CONFIG`, `KUBECONFIG`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `GNUPGHOME`, `NETRC`, `GIT_ASKPASS` / `SSH_ASKPASS` / `SUDO_ASKPASS`, `*_AUTH*`). Odd names can still survive on the *podman client* env. bwrap `--clearenv` + allowlisted `--setenv` is the jail boundary; podman `run` only passes `SPOCKIFY_JOB_ID` into the container. |
| G1-12 | Info | Accepted | Jobs older than 2h drop from the admission cap but files remain. Single-tenant only. |
| G1-13 | Medium | Fixed this pass | Compose production profile writes `$XDG_CONFIG_HOME/spockify/isolation.env` (or `SPOCKIFY_HOST_ISOLATION_ENV`) with `SPOCKIFY_PRODUCTION=1` and `SPOCKIFY_ISOLATED_RUNNER=bwrap\|podman`. Harness `mergeHostIsolationEnv` fills those keys when the host process env is unset. Process env still wins. Check fails closed if the file cannot be written. |
| G1-14 | Medium | Fixed this pass | `SPAWN_CODING` `kind=bash` calls `authorizeTool`. Deny-class **and** ask-class return a `blocked:` digest (no confirm skip, no yolo bypass). Auto-class still runs (`pytest`, `make test`, `git status`/`diff`). `git push` is ask. |
| G1-15 | Medium (was) | Fixed in tree | Default job dir was `<cwd>/.spockify/jobs` — inside the workspace bind, so a jailed command could rewrite admission records and `audit.jsonl`. Default is now `$XDG_RUNTIME_DIR/spockify-jobs/<workspace>` (else `os.tmpdir()`). Override `SPOCKIFY_JOB_DIR` still wins. |
| G1-16 | Low (was) | Fixed in tree | Admission cap was check-then-write with **no** lock (the table previously claimed a lock). Exclusive `.admit.lock` (`wx`) now serializes admit. Still not authn. |

## This pass (2026-10-17)

**Reviewer:** implementing agent (agent mode). Isolation increment + G1-10.
**Operator:** Tim waived G1-09 the same day (not a pentest).
**Files reviewed / changed:**

- `packages/spockify-harness/src/seccomp.ts` (new)
- `packages/spockify-harness/src/isolate.ts`
- `packages/spockify-harness/src/kill.ts` (`--seccomp` FD inherit)
- `packages/spockify-harness/src/loop.ts` (`SPAWN_CODING` ask-class)
- `packages/spockify-harness/src/job.ts` (`redactReason` on audit `reason`)
- `packages/spockify-harness/src/permissions.ts` (G1-03 `git push` ask; path-prefixed `rm`)
- `packages/spockify-harness/test/isolate.test.ts`
- `packages/spockify-harness/test/codingSpawn.test.ts`
- `packages/spockify-harness/test/job.test.ts`
- `packages/spockify-harness/test/permissions.test.ts`
- `docker/check-production-secrets.sh`
- `docker/test/production-profile.test.sh`

**Confirmed present (do not rubber-stamp):**

- No `docker.sock` / `podman.sock` in generated bwrap/podman argv; `assertNoForbiddenBinds` fail-closed; live bwrap `cat` of host docker.sock fails (tmpfs on `/run` and `/var/run`); workspace `docker.sock` is masked.
- bwrap `--clearenv` + allowlisted `--setenv`.
- bwrap `--seccomp` deny-list BPF; production + `SPOCKIFY_BWRAP_SECCOMP=0` → `IsolationRequiredError`.
- Explicit `bwrap` / `podman` missing binary → `IsolationRequiredError` (no swap).
- `SPOCKIFY_PRODUCTION=1` without a backend → `IsolationRequiredError`.
- Compose production profile refuses missing / `none` isolated runner and writes host `isolation.env`.
- `SPAWN_CODING` `rm -rf /` (deny) and `touch ASK_RAN` (ask) are broker-gated.

**Verdict:** **operator-signed** (G1-09 waived by Tim 2026-10-17; not a pentest).
Implementable residuals G1-05, G1-10, G1-13, and G1-14 are closed. G1-03 was
tightened (git push / path-prefixed rm) but is still a regex heuristic. G1-04/06/11
are tighter, not gone. G1-07 (local job store, not multi-tenant) remains on purpose.

## Enforcement vs heuristic

| Control | Enforcement |
|---------|-------------|
| Production without bwrap/podman | Hard error (`IsolationRequiredError`) |
| Explicit `bwrap` / `podman` missing binary | Hard error (no swap) |
| Production bwrap without seccomp | Hard error (`IsolationRequiredError`) |
| docker.sock / podman.sock / SSH agent / `/var/run` binds | Hard error on argv |
| Workspace `docker.sock` / `podman.sock` | Overlay `/dev/null` on known paths |
| Host env in bwrap jail | `--clearenv` + allowlisted `--setenv` |
| Host env on isolated spawn | `sanitizeIsolateEnv` (heuristic name strip) |
| `run_tests` metacharacters | Allowlist + strip |
| `shell` / `bash` command class | Regex heuristic + OS jail |
| `SPAWN_CODING` bash deny-class | `authorizeTool` deny → blocked digest |
| `SPAWN_CODING` bash ask-class | `authorizeTool` ask → blocked digest |
| Compose vs CLI isolation env | Compose writes host `isolation.env`; harness merges missing keys |
| Job over-cap | Local exclusive lock + count; not authn |

## Negative tests that exist

- Agent-issued grant denied in plan/build/yolo (`SEC-01`).
- `run_tests` metacharacters and non-allowlist denied (`SEC-02`).
- Symlink path escape denied (`resolveSafe`).
- Production without bwrap/podman throws `IsolationRequiredError`.
- Explicit `bwrap` or `podman` missing binary throws (no swap).
- Argv must not bind docker/podman sockets, SSH agent sockets, or `/var/run`.
- Live bwrap (when installed): cannot read a file outside the workspace bind; docker.sock cat fails; `--unshare-net` blocks `/dev/tcp`; `SSH_AUTH_SOCK` empty inside the jail; `unshare -n` is seccomp-blocked; workspace `docker.sock` is masked.
- Job admission rejects over-cap spawns and writes a redacted audit line (secret-shaped keys and `reason` values).
- Default job dir is outside the workspace; admit lock is not left behind.
- Compose production profile refuses missing / `none` isolated runner and exports host isolation env.
- `SPAWN_CODING` `rm -rf /` is deny-gated; `touch ASK_RAN` is ask-gated; `git push` is ask-gated.
- `/bin/rm -rf /` and `rm -fr /` classify deny; `git status` stays auto.

## Residual risks (why G1 is not a pentest pass)

- G1-09 is an **operator waiver**, not a pentest (Tim, 2026-10-17).
- Shell classifier is still a heuristic (G1-03). SPAWN_CODING blocks ask/deny; auto-class `git push` is now ask.
- Device/filesystem allowlist is minimal, not an LSM profile (G1-04 residual).
- Other workspace unix sockets besides the named docker/podman paths stay reachable (G1-06 residual).
- Job store is not a tenant boundary (G1-07). Left local on purpose.
- Env strip is still a blacklist on the podman client (G1-11 residual).

## What this review does not claim

- Not a penetration test.
- Not a tenant-isolation certification.
- Not coverage of malicious MCP servers (C-01 still P2).
- Not a GPU scorecard (G2) and not a restore SLO (G6).
