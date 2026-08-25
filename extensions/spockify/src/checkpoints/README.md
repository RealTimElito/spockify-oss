# Checkpoints (`src/checkpoints`)

Pre-apply snapshots (WS-CLONE-I). Durable under `<workspace>/.spockify/checkpoints/<id>/` (local + Remote SSH). Not a git stash GUI; one-step **Undo** is still session-only.

## Flow

1. `ApplyService.apply` records pre-apply bytes + `checkpointId`.
2. `bindApplyService` copies that snapshot into `CheckpointStore`.
3. **Undo last apply** (`spockify.applyUndo` / Ctrl+Alt+Z) rewrites the most recent apply only.
4. **List / restore** (`spockify.checkpoints.list`) QuickPick → confirm → overwrite files with snapshot contents; clears one-step undo.

## Commands

| Command | Role |
|---------|------|
| `spockify.applyUndo` | Undo last apply (empty → offer Checkpoints) |
| `spockify.checkpoints.list` | Timeline QuickPick → restore |
| `spockify.checkpoints.restore` | Restore by id or open picker |
| `spockify.checkpoints.create` | Manual snapshot of active editor |

Status bar shows `undo · N` when a one-step undo exists, else `N` checkpoint count.
