/**
 * Format finished agent-run worker output for chat / tool history.
 * Cards are UI-only — follow-up turns need stdout/summary in the messages array.
 */

const MAX_BODY = 4000;
const MAX_TOTAL = 24_000;

export type AgentRunTranscriptWorker = {
  name?: string;
  id?: string;
  ok?: boolean;
  state?: string;
  result?: string;
  body?: string;
  error?: string;
};

/** Build markdown the model (and user) can use on the next turn. */
export function formatAgentRunTranscript(opts: {
  heading: string;
  synthesis?: string;
  workers?: AgentRunTranscriptWorker[];
  error?: string;
}): string {
  const synth = (opts.synthesis || '').trim();
  if (synth) {
    const head = (opts.heading || '').trim();
    return clip(head ? `${head}\n\n${synth}` : synth, MAX_TOTAL);
  }

  const workers = opts.workers || [];
  if (workers.length) {
    const blocks = workers.map((w, i) => {
      const label = w.name || w.id || `Worker ${i + 1}`;
      const ok =
        w.ok === true ||
        w.state === 'done' ||
        (w.ok !== false && w.state !== 'failed' && !w.error);
      const body = (w.result || w.body || w.error || '(no output)').trim();
      return `### ${label} (${ok ? 'ok' : 'failed'})\n\`\`\`\n${body.slice(0, MAX_BODY)}\n\`\`\``;
    });
    return clip(`${opts.heading}\n\n${blocks.join('\n\n')}`, MAX_TOTAL);
  }

  const err = (opts.error || '').trim();
  if (err) {
    return clip(`${opts.heading}\n\n${err}`, MAX_TOTAL);
  }
  return opts.heading;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n\n…(truncated)`;
}
