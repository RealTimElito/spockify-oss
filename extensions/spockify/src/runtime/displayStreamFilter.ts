/**
 * Hide tool-call syntax from chat UI while streaming (incomplete fences buffered).
 */

import { stripToolFences } from './parseToolCalls';

/** Drop trailing partial ```tool / ```tool Apply / <tool_call openers. */
export function stripIncompleteToolSuffix(text: string): string {
  let s = text;
  const open = s.lastIndexOf('```');
  if (open >= 0) {
    const tail = s.slice(open);
    const closeAt = tail.indexOf('```', 3);
    if (closeAt < 0) {
      const firstLine = tail.slice(3).split('\n')[0]?.trim() ?? '';
      // Only real tool fences. A blank or json info line is a normal code block.
      const toolish =
        /^tool\b/i.test(firstLine) ||
        /^tool\s+apply\b/i.test(firstLine) ||
        firstLine.toLowerCase() === 'apply';
      if (toolish) {
        s = s.slice(0, open);
      }
    }
  }
  const tc = s.lastIndexOf('<tool_call');
  if (tc >= 0 && !/<\/tool_call>/i.test(s.slice(tc))) {
    s = s.slice(0, tc);
  }
  // If the model is mid-way through emitting a tool JSON object, remove it
  // so partial `"name"` / `"arguments"` never leak into the UI.
  const incompleteNameArgsJson =
    /(?:^|\n)\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w-]*"\s*,\s*"arguments"\s*:\s*[\s\S]*$/i.exec(
      s,
    );
  if (incompleteNameArgsJson?.index != null) {
    s = s.slice(0, incompleteNameArgsJson.index);
  }
  const incompleteFunctionNameJson =
    /(?:^|\n)\s*\{\s*"function"\s*:\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w-]*"[\s\S]*$/i.exec(
      s,
    );
  if (incompleteFunctionNameJson?.index != null) {
    s = s.slice(0, incompleteFunctionNameJson.index);
  }
  const incompleteInvokeJson =
    /(?:^|\n)\s*(?:call|invoke)\s+[a-zA-Z0-9_]+\s+with\s+\{\s*[\s\S]*$/i.exec(
      s,
    );
  if (incompleteInvokeJson?.index != null) {
    s = s.slice(0, incompleteInvokeJson.index);
  }
  const react = s.match(
    /(?:^|\n)\s*tool\s+[A-Za-z_][\w]*\s*\{[\s\S]*$/,
  );
  if (react) {
    s = s.slice(0, react.index! + (react[0].startsWith('\n') ? 1 : 0));
  }
  return s;
}

/** Pull completed + in-flight `<think>` bodies for the reasoning panel. */
export function extractThinkText(raw: string): string {
  const parts: string[] = [];
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    parts.push(m[1] || '');
  }
  const lastOpen = raw.toLowerCase().lastIndexOf('<think>');
  if (lastOpen >= 0) {
    const after = raw.slice(lastOpen + '<think>'.length);
    if (!/<\/think>/i.test(after)) {
      parts.push(after);
    }
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimStart();
}

/** Full assistant body safe to show in the webview (no tool/ReAct leakage). */
export function assistantTextForDisplay(raw: string): string {
  const stripped = stripToolFences(raw, { trim: false });
  const noPartialTools = stripIncompleteToolSuffix(stripped);
  return noPartialTools
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** Incremental filter: emit only new visible characters per chunk. */
export class DisplayStreamFilter {
  private raw = '';
  private lastVisible = '';
  private lastReasoning = '';
  private pendingReasoning = '';

  reset(): void {
    this.raw = '';
    this.lastVisible = '';
    this.lastReasoning = '';
    this.pendingReasoning = '';
  }

  push(chunk: string): string {
    if (!chunk) return '';
    this.raw += chunk;
    const visible = assistantTextForDisplay(this.raw);
    const delta = visible.slice(this.lastVisible.length);
    this.lastVisible = visible;
    const reasoning = extractThinkText(this.raw);
    const rDelta = reasoning.slice(this.lastReasoning.length);
    this.lastReasoning = reasoning;
    if (rDelta) this.pendingReasoning += rDelta;
    return delta;
  }

  /** Drain newly extracted `<think>` text since the last take. */
  takeReasoningDelta(): string {
    const d = this.pendingReasoning;
    this.pendingReasoning = '';
    return d;
  }

  /** Call at end of stream to release any held suffix. */
  flush(): string {
    const visible = assistantTextForDisplay(this.raw);
    const delta = visible.slice(this.lastVisible.length);
    this.lastVisible = visible;
    const reasoning = extractThinkText(this.raw);
    const rDelta = reasoning.slice(this.lastReasoning.length);
    this.lastReasoning = reasoning;
    if (rDelta) this.pendingReasoning += rDelta;
    return delta;
  }
}
