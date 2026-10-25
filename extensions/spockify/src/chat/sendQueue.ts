/**
 * Per-chat-tab FIFO send queue (pure, no vscode) — lets the composer accept
 * new submissions while a turn is still streaming (Cursor / Claude Code
 * style) instead of blocking input or silently dropping the message.
 *
 * One queue per chatTabId, deliberately just an array + a monotonically
 * increasing id — not a job scheduler. `ChatPanelProvider` owns a
 * `Map<chatTabId, QueuedSend[]>` and calls these pure helpers so the
 * behavior is unit-testable without a running Extension Host.
 */

export interface QueuedSend {
  id: string;
  userText: string;
  model: string;
  withContext: boolean;
  contextTags?: ('file' | 'codebase' | 'terminal' | 'web')[];
  selectionChips?: Array<{
    id: string;
    fileName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    text: string;
  }>;
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    kind: 'image' | 'file';
    dataUrl?: string;
    textContent?: string;
    size: number;
  }>;
}

let counter = 0;

/** Reset the id counter — tests only, keeps assertions deterministic. */
export function resetQueuedSendIdsForTests(): void {
  counter = 0;
}

export function nextQueuedSendId(): string {
  counter += 1;
  return `qs${counter}`;
}

export function enqueueSend(
  queue: QueuedSend[],
  item: Omit<QueuedSend, 'id'>,
): QueuedSend[] {
  const withId: QueuedSend = { ...item, id: nextQueuedSendId() };
  return [...queue, withId];
}

/** Pop the head of the queue; returns the popped item and the remainder. */
export function dequeueSend(queue: QueuedSend[]): {
  item: QueuedSend | undefined;
  rest: QueuedSend[];
} {
  if (!queue.length) {
    return { item: undefined, rest: queue };
  }
  const [item, ...rest] = queue;
  return { item, rest };
}

/** Remove one queued item by id, or clear the whole queue when `id` is omitted. */
export function removeQueuedSend(
  queue: QueuedSend[],
  id?: string,
): QueuedSend[] {
  if (!id) return [];
  return queue.filter((q) => q.id !== id);
}

export function queuedSendPreview(
  text: string,
  max = 64,
  attachmentCount = 0,
): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t && attachmentCount > 0) {
    return attachmentCount === 1
      ? '1 attachment'
      : `${attachmentCount} attachments`;
  }
  if (!t) return '';
  const base = t.length > max ? `${t.slice(0, max - 1)}…` : t;
  if (attachmentCount > 0) {
    return `${base} · ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`;
  }
  return base;
}

export function toQueuedSendViewList(
  queue: QueuedSend[],
): { id: string; preview: string }[] {
  return queue.map((q) => ({
    id: q.id,
    preview: queuedSendPreview(q.userText, 64, q.attachments?.length ?? 0),
  }));
}
