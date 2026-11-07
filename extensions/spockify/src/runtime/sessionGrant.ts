/**
 * One Allow per session + normalized exe+argv.
 * bash and shell share a grant; grants do not persist across sessions.
 */

export function normalizeGrantExeArgv(command: string): string {
  const s = (command || '').trim().replace(/\s+/g, ' ');
  return s.replace(/^(?:\/[\w./-]+\/)?(?:bash|sh|shell)(?=\s|$)/i, 'shell');
}

export function sessionCommandGrantKey(
  sessionId: string,
  title: string,
  commandPreview: string,
): string {
  const exe = (title || '').toLowerCase().replace(/\b(?:ba)?sh\b/g, 'shell');
  return `${sessionId || '_'}\n${exe}\n${normalizeGrantExeArgv(commandPreview)}`;
}
