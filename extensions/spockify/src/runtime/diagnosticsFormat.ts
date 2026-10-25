/** Plain-text editor diagnostics for the agent. No vscode import. */

export type DiagHit = {
  path: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
};

export function formatDiagnostics(hits: readonly DiagHit[], limit = 20): string {
  if (!hits.length) return '';
  const shown = hits.slice(0, limit);
  const lines = shown.map(
    (hit) => `${hit.path}:${hit.line} ${hit.severity}: ${hit.message}`,
  );
  if (hits.length > shown.length) {
    lines.push(`…${hits.length - shown.length} more`);
  }
  return lines.join('\n');
}
