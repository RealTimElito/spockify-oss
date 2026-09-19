/** Checkpoint id + index parsing (no vscode — unit-testable). */

export const CHECKPOINT_ID_RE = /^cp_[a-z0-9_]+$/;

export function sanitizeCheckpointId(id: string): string {
  if (!CHECKPOINT_ID_RE.test(id)) {
    throw new Error(`Invalid checkpoint id: ${id}`);
  }
  return id;
}

/** Parse index.json body. */
export function parseCheckpointIndex(text: string): string[] {
  const parsed = JSON.parse(text) as { ids?: string[] };
  if (!Array.isArray(parsed.ids)) {
    return [];
  }
  return parsed.ids.filter(
    (id) => typeof id === 'string' && CHECKPOINT_ID_RE.test(id),
  );
}
