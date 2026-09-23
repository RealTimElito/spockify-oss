export type SlashCommand = {
  name: string;
  hint: string;
};

export const EVAL_SLASH_COMMANDS: SlashCommand[] = [
  { name: '/resume', hint: 'Continue a saved chat' },
  { name: '/model', hint: 'Pick a planner' },
  { name: '/think', hint: 'Cycle thinking Off→Low→Med→High→Heavy' },
  { name: '/autonomy', hint: 'Retune the approval gate (L0–L3)' },
  { name: '/scope', hint: 'Show or load a customer / test scope brief' },
  { name: '/score', hint: 'Score this run against the catalogue' },
  { name: '/findings', hint: 'Finding cards; /findings edit <id> field=value before /approve' },
  { name: '/done', hint: 'Force a close-out turn: submit findings or declare none' },
  { name: '/report', hint: 'Write a pentest report from findings (score appended)' },
  { name: '/expand', hint: 'Same report plus full transcript appendix' },
  { name: '/approve', hint: 'Accept queued findings/report after reviewing cards' },
  { name: '/kill', hint: 'Stop the evaluation session' },
  { name: '/tools', hint: 'List tools loaded in this session' },
  { name: '/status', hint: 'Session details' },
  { name: '/clear', hint: 'Clear conversation' },
  { name: '/help', hint: 'Show this help' },
  { name: '/exit', hint: 'Quit' },
];

export const CODING_SLASH_COMMANDS: SlashCommand[] = [
  { name: '/ask', hint: 'Ask mode — read-only' },
  { name: '/plan', hint: 'Plan mode — read-only' },
  { name: '/agent', hint: 'Agent mode — can edit and run tools' },
  { name: '/build', hint: 'Build mode — writes' },
  { name: '/init', hint: 'Write AGENTS.md project memory' },
  { name: '/mode', hint: 'Mode / permissions picker' },
  { name: '/yolo', hint: 'Toggle run all' },
  { name: '/revoke', hint: 'Clear session tool grants' },
  { name: '/model', hint: 'Pick a model' },
  { name: '/skill', hint: 'Attach ≤2 skills' },
  { name: '/think', hint: 'Cycle thinking Off→Low→Med→High→Heavy' },
  { name: '/tools', hint: 'List tools' },
  { name: '/status', hint: 'Session details' },
  { name: '/clear', hint: 'Clear conversation' },
  { name: '/help', hint: 'Show this help' },
  { name: '/exit', hint: 'Quit' },
];

/** True when the boxed line is a slash prefix (no args yet) and the menu should open. */
export function slashMenuQuery(text: string): string | null {
  if (!text.startsWith('/')) return null;
  if (text.includes('\n')) return null;
  if (/\s/.test(text)) return null;
  return text;
}

export function filterSlashCommands(query: string, commands: SlashCommand[]): SlashCommand[] {
  const q = query.replace(/^\//, '').toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => {
    const name = c.name.slice(1).toLowerCase();
    return name.startsWith(q) || name.includes(q);
  });
}
