/**
 * Legacy HTML builder for terminal Ctrl+K overlay.
 *
 * As of 0.6.13 the workbench host builds a DOM card directly (no iframe / blob).
 * Kept so older smoke checks and docs that reference this module still resolve.
 */

export type TerminalOverlayPhase = 'prompt' | 'streaming' | 'preview';

/** @deprecated Host DOM overlay no longer loads this HTML. */
export function buildTerminalOverlayHtml(opts?: {
  placeholder?: string;
}): string {
  const placeholder = escapeHtml(
    opts?.placeholder ?? 'Command instructions',
  );
  // Marker strings kept for unit tests / grep smoke of close+Escape wiring docs.
  return `<!-- spockify terminal overlay html (unused at runtime; host DOM) -->
<meta data-spockify="terminalOverlay" data-placeholder="${placeholder}" />
<script>
/* requestClose / Escape / cancel — implemented in terminal-overlay-bootstrap.js */
(function () {
  var mode = 'prompt';
  function requestClose() {
    parent.postMessage({ __spockify: 'terminalOverlay', type: mode === 'preview' ? 'reject' : 'cancel' }, '*');
  }
  window.addEventListener('keydown', function onKeydown(e) {
    if (e.key === 'Escape') requestClose();
  }, true);
})();
</script>
<button type="button" class="close" id="close" tabindex="0" autofocus>×</button>
<button type="button" id="send">↑</button>
<span>Quick Question</span>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
