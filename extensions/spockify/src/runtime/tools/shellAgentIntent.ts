/**
 * Detect shell/network probe prompts that belong in the local terminal,
 * not remote LLM parallel workers (Explorer/Analyst).
 *
 * Also detect explicit multi-agent / parallel-runner language so chat Send
 * can spawn runners without the Agents chrome toggle.
 */

export const SHELL_AGENT_INTENT_RE =
  /\b(ping|curl|wget|dig|nslookup|traceroute)\b/i;

/** "two agents", "3 agents", "have 4 agents", … */
const COUNT_AGENTS_RE = /\b(?:have\s+)?(two|three|four|\d+)\s+agents?\b/i;

/** spawn/launch agents, agents…parallel, parallel…agents */
const SPAWN_OR_PARALLEL_AGENTS_RE =
  /\b(?:spawn|launch)\s+(?:the\s+)?(?:parallel\s+)?agents?\b|\bagents?\b[^\n]{0,80}\b(?:in\s+)?parallel\b|\b(?:in\s+)?parallel\b[^\n]{0,80}\bagents?\b/i;

export function preferTerminalForPrompt(prompt: string): boolean {
  return SHELL_AGENT_INTENT_RE.test(prompt);
}

/**
 * Explicit multi-agent / parallel runner request (not every mention of "agent").
 * Includes parallel shell probes without the word "agents".
 */
export function hasMultiAgentSpawnIntent(prompt: string): boolean {
  if (COUNT_AGENTS_RE.test(prompt)) return true;
  if (SPAWN_OR_PARALLEL_AGENTS_RE.test(prompt)) return true;
  if (preferTerminalForPrompt(prompt) && /\b(?:in\s+)?parallel\b/i.test(prompt)) {
    return true;
  }
  return false;
}

/**
 * Auto-spawn runners from chat Send without the Agents button.
 * Shell probes alone still go through the normal agent (terminal_run);
 * only explicit multi-agent / parallel language triggers this.
 * Multitask UI mode alone must NOT trigger this — simple Q&A stays single-agent.
 */
export function shouldAutoSpawnAgentRun(prompt: string): boolean {
  // Intent is checked against the user-visible ask, not huge @context blobs
  // that can false-positive on docs mentioning "agents" / "parallel".
  const head = (prompt || '').split(/\n---\n/)[0] || prompt || '';
  return hasMultiAgentSpawnIntent(head.trim());
}

export function shellWorkerCount(prompt: string): number {
  const word = prompt.match(COUNT_AGENTS_RE);
  if (!word) return 2;
  const v = word[1].toLowerCase();
  if (v === 'two') return 2;
  if (v === 'three') return 3;
  if (v === 'four') return 4;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : 2;
}

/** Best-effort command for common probe prompts (ping google.com 10×, etc.). */
export function extractShellCommand(prompt: string): string | undefined {
  const pingHost = prompt.match(
    /\bping\b(?:[^.\n]*?\s)?([a-z0-9.-]+\.[a-z]{2,})\b/i,
  );
  if (pingHost) {
    const count =
      prompt.match(/\b(\d+)\s*times?\b/i)?.[1] ||
      prompt.match(/-c\s*(\d+)/i)?.[1] ||
      '10';
    return `ping -c ${count} ${pingHost[1]}`;
  }
  const curl = prompt.match(/\bcurl\b[^\n]{0,200}/i);
  if (curl) return curl[0].trim();
  const wget = prompt.match(/\bwget\b[^\n]{0,200}/i);
  if (wget) return wget[0].trim();
  const dig = prompt.match(/\b(?:dig|nslookup|traceroute)\b[^\n]{0,120}/i);
  if (dig) return dig[0].trim();
  return undefined;
}
