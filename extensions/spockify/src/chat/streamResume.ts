/**
 * Pure helpers for chat webview stream / Thinking UI resume rules.
 */

export type StreamResumeInput = {
  /** Host explicitly asks to resume (tab remount mid-turn). */
  resumeStreaming?: boolean;
  /** Local webview flag before history rebuild clears it. */
  wasLocallyStreaming: boolean;
  /** Tab id still listed in sessions.streamingTabIds. */
  tabListedAsStreaming: boolean;
  /**
   * True only between streamStart and a terminal event (done/stop/error).
   * Prevents stale streamingTabIds after done from re-arming Thinking.
   */
  acceptStreamEvents: boolean;
};

/** Whether a history rebuild should re-arm streaming + live Thinking UI. */
export function shouldResumeStreamingAfterHistory(
  input: StreamResumeInput,
): boolean {
  if (input.resumeStreaming) return true;
  if (!input.acceptStreamEvents) return false;
  return input.wasLocallyStreaming || input.tabListedAsStreaming;
}
