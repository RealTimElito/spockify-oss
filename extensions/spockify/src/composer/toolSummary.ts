/** One-line tool argument summary for Composer tool rows (parity with Chat cards). */

export function toolArgsSummary(
  name: string,
  args: Record<string, unknown> | undefined,
): string {
  if (!args || typeof args !== 'object') {
    return '';
  }
  if (name === 'terminal_run') {
    return String(args.command || args.cmd || '').slice(0, 200);
  }
  if (name === 'apply_patch') {
    const paths: string[] = [];
    const files = Array.isArray(args.files) ? args.files : [];
    for (const f of files) {
      if (f && typeof f === 'object' && 'path' in f && f.path) {
        paths.push(String((f as { path: string }).path));
      }
    }
    if (args.path) {
      paths.push(String(args.path));
    }
    if (!paths.length) {
      return 'patch';
    }
    return (
      paths.slice(0, 6).join(', ') + (paths.length > 6 ? '…' : '')
    );
  }
  if (name === 'codebase_search') {
    return String(args.query || '').slice(0, 160);
  }
  if (name === 'grep') {
    return String(args.pattern || args.query || '').slice(0, 160);
  }
  if (name === 'glob_file_search') {
    return String(args.glob || args.pattern || '').slice(0, 160);
  }
  if (name === 'read_file' || name === 'write_file') {
    return String(args.path || '').slice(0, 200);
  }
  if (name === 'list_dir') {
    return String(args.path || args.directory || '.').slice(0, 200);
  }
  if (name.startsWith('mcp__')) {
    try {
      return JSON.stringify(args).slice(0, 160);
    } catch {
      return '';
    }
  }
  return '';
}
