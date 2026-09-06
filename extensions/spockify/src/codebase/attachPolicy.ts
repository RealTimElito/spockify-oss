/**
 * Decide when Chat/Composer should inject @codebase retrieval into the turn.
 *
 * Indexing alone does not help the model — hits must be attached (or the model
 * must call codebase_search). Default: auto-attach in agent-family modes.
 */

export type CodebaseAttachUiMode =
  | 'agent'
  | 'plan'
  | 'debug'
  | 'multitask'
  | 'ask'
  | 'strict'
  | string;

export function isAgentFamilyMode(mode: CodebaseAttachUiMode): boolean {
  return (
    mode === 'agent' ||
    mode === 'plan' ||
    mode === 'debug' ||
    mode === 'multitask' ||
    mode === 'strict'
  );
}

/**
 * @param explicit — user toggled @codebase chip or typed @codebase/@folder
 * @param autoAttach — spockify.codebase.autoAttach (default true)
 * @param autoAttachAsk — also auto in Ask mode (default true)
 */
export function shouldAttachCodebase(opts: {
  explicit: boolean;
  autoAttach: boolean;
  autoAttachAsk: boolean;
  uiMode: CodebaseAttachUiMode;
}): boolean {
  if (opts.explicit) return true;
  if (!opts.autoAttach) return false;
  if (isAgentFamilyMode(opts.uiMode)) return true;
  if (opts.uiMode === 'ask') return opts.autoAttachAsk;
  return false;
}
