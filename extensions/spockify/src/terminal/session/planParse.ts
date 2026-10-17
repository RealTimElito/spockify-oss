/**
 * Pure plan parsing (no vscode) — used by Terminal Agent + unit tests.
 */

export interface PlanStep {
  n: number;
  text: string;
}

/** Extract numbered plan steps from model text (1. / 1) / - 1.). */
export function parseNumberedPlan(text: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const seen = new Set<number>();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:#{1,3}\s*)?(?:[-*]\s+)?(\d+)[.)]\s+(.+?)\s*$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 40 || seen.has(n)) continue;
    const body = m[2].replace(/\*\*/g, '').trim();
    if (body.length < 2) continue;
    seen.add(n);
    steps.push({ n, text: body.slice(0, 240) });
  }
  steps.sort((a, b) => a.n - b.n);
  return steps;
}

export function formatPlanForPrompt(steps: PlanStep[]): string {
  return steps.map((s) => `${s.n}. ${s.text}`).join('\n');
}
