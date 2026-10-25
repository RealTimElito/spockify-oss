/** Whether a streamed agent event belongs on the visible chat tab. */
export function shouldDeliverStreamToView(
  chatTabId: string | undefined,
  viewTabId: string,
): boolean {
  return !chatTabId || chatTabId === viewTabId;
}
