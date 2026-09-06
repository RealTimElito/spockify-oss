# Terminal Agent (Phase 5)

Uses Phase 1 `AgentRuntime` + `terminal_run`.

## Policy

- `spockify.terminalAgent.policy`: `ask` (default) | `allowlist` | `deny`
- `spockify.terminalAgent.allowlistTier`: `read` | `dev` (default) | `build` | `custom`
  - **read** — inspection only (ls/git status/rg)
  - **dev** — read + test/typecheck/build scripts
  - **build** — dev + npm ci / make / docker build
  - **custom** — only `spockify.terminalAgent.allowlist`
- Custom allowlist patterns are **unioned** with the tier (unless `custom`)
- Defaults for long-horizon: `maxTurns` **32** (cap 80), `timeoutMs` **60000** (60s; raise for long builds; pass `timeoutMs` in `terminal_run` args when needed)
- Dangerous patterns always denied; audit → `.spockify/terminal-audit.jsonl`
- Approval UX: policy/tier/cwd badge + **Allow for session** (session-scoped pattern)
- Optional **OS sandbox** (`spockify.terminalAgent.osSandbox`): `off` (default) | `network` | `workspace`
  - Linux captured exec only; uses host **bwrap** when present, else AppImage-bundled `resources/helpers/bwrap`
  - Override: `SPOCKIFY_BWRAP`; AppRun sets `SPOCKIFY_BWRAP_BUNDLED` for the packaged helper
  - `network` → `--unshare-net` (no outbound net); **`workspace`** → workspace RW / system RO, **network allowed** (preferred FS jail)
  - Skipped on Remote SSH and integrated-terminal sendText
  - `osSandboxFailClosed` (default **false**): when jail cannot apply (no bwrap / no cwd), **deny** instead of unsandboxed fallback
- Rewind: `Spockify: Terminal Agent Rewind`
- Policy status: `Spockify: Terminal Agent Policy Status`
- OS sandbox check: `Spockify: Check OS Sandbox` (`spockify.terminalAgent.checkSandbox`) — can enable workspace jail; status bar terminal chip clicks here

Opt into autonomy: set policy to `allowlist` + choose a tier. Default remains **ask**.
Opt into OS jail: set `osSandbox` to **`workspace`** (or `network`). Install `bubblewrap` on the host **or** use an AppImage that ships the helper. Enable `osSandboxFailClosed` if you want missing bwrap to block rather than soft-fallback.

**Permissions** (`spockify.agentPermissionMode`, default **askEveryTime**):

| Mode | Shell | OS sandbox | File edits |
|------|-------|------------|------------|
| `allowAll` | auto-approve (non-catastrophic) | forced off | auto-apply |
| `askEveryTime` | always confirm | settings | inline / Composer review |
| `autoRunReviewFiles` | auto-approve | settings | inline Accept / Reject |

Ask mode stays read-only regardless. Legacy `spockify.runAllUnsandboxed` maps to `allowAll` when true.

## Plan UI

- `spockify.terminalAgent.planApproval` (default **true**): planning turn → numbered plan preview → Approve / Edit / Skip → execute
- Approved plan is locked into the system prompt for the tool loop

## Multi-session

- Secondary sidebar **Terminal** view: active + recent sessions
- Commands: Sessions, Continue, Open Session, Refresh
- Concurrent runs: each invocation gets its own session id + progress notification

## SSH

`cwd` = `workspaceFolders[0].uri.fsPath` (works for OSS Remote SSH remote folders). Inference still → spockify.eu (not on the SSH host).

**Captured `terminal_run` on Remote SSH:** Spockify is `extensionKind: ["ui"]`, so `child_process.spawn` would run on the **laptop** (classic `spawn /bin/bash ENOENT`). When `vscode.env.remoteName` is set, `runTerminalTool` uses the remote integrated terminal (`shellIntegration` or a `workspace.fs` stdout bridge) instead. File create/edit should use `write_file` / `apply_patch` (`vscode.workspace.fs`).

**OS sandbox on Remote SSH:** local `bwrap` cannot jail the remote shell. OS jail is skipped; policy/deny patterns still apply. For OS isolation under SSH, install bubblewrap on the **remote host** (future host-side jail).

## Composer handoff

`runComposerVerify` / `runTerminalTool` — Composer verify calls the same protocol without owning policy.
