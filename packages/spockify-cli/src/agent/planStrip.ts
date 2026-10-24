/** One-line plan the CLI prints after todowrite. Same statuses as the harness. */

const MARK: Record<string, string> = {
  completed: '✓',
  in_progress: '•',
  cancelled: '–',
  pending: '○',
};

export function formatPlanStrip(
  todos: readonly { status?: string; content?: string }[],
): string {
  const rows = todos.filter((item) => (item.content || '').trim());
  if (!rows.length) return '';
  const lines = ['Plan'];
  for (const item of rows) {
    const mark = MARK[item.status || ''] || MARK.pending;
    lines.push(`  ${mark} ${(item.content || '').trim()}`);
  }
  return lines.join('\n');
}

export function formatSwarmWorkerLine(row: {
  title?: string;
  state?: string;
  statusLabel?: string;
  error?: string;
}): string {
  const title = (row.title || 'worker').trim();
  const label = (row.statusLabel || row.state || 'running').trim();
  const err =
    row.state === 'failed' && row.error?.trim() ? ` — ${row.error.trim()}` : '';
  return `${title}: ${label}${err}`;
}

/** Queue questions so parallel swarm workers do not talk over each other. */
export function serializeAsk(
  ask: (prompt: string) => Promise<string>,
): (prompt: string) => Promise<string> {
  let chain: Promise<void> = Promise.resolve();
  return (prompt: string) => {
    const run = chain.then(() => ask(prompt));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
