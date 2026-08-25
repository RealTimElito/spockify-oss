/**
 * Cursor-like whitespace visualization for diff previews.
 * Spaces → ·, tabs → → (keeps layout readable without collapsing runs).
 */

const SPACE = '\u00b7'; // ·
const TAB = '\u2192'; // →

/** Replace space/tab with visible glyphs; leave other chars intact. */
export function visualizeWhitespace(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') out += SPACE;
    else if (ch === '\t') out += TAB;
    else out += ch;
  }
  return out;
}

/** Escape HTML then visualize whitespace (for webview diffs). */
export function escapeHtmlVisualizeWs(text: string): string {
  return visualizeWhitespace(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Truncate for ghost decorations without collapsing whitespace runs.
 * Keeps the first `max` *display* characters after visualization.
 */
export function truncatePreservingWs(text: string, max = 160): string {
  const vis = visualizeWhitespace(text.replace(/\r$/, ''));
  if (vis.length <= max) return vis;
  return `${vis.slice(0, Math.max(1, max - 1))}…`;
}
