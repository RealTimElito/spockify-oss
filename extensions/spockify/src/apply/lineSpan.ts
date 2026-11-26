/**
 * Locate the changed line span via common prefix + common suffix.
 * Used for minimal ranged TextEdits and surgical patch recover.
 */

export type LineEditSpan = {
  /** 0-based first differing line. */
  start: number;
  /** Exclusive end index in current. */
  oldEnd: number;
  /** Exclusive end index in proposed. */
  newEnd: number;
  /** Trailing lines identical in both (from EOF upward). */
  suffixKept: number;
};

function splitLines(text: string): string[] {
  // Keep trailing "" from a final newline so span math matches buffer lines.
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Returns undefined when texts are identical (after newline normalize).
 */
export function findChangedLineSpan(
  current: string,
  proposed: string,
): LineEditSpan | undefined {
  const cur = splitLines(current);
  const prop = splitLines(proposed);
  if (cur.length === prop.length && cur.every((l, i) => l === prop[i])) {
    return undefined;
  }

  let start = 0;
  const minLen = Math.min(cur.length, prop.length);
  while (start < minLen && cur[start] === prop[start]) start++;

  let curJ = cur.length - 1;
  let propJ = prop.length - 1;
  while (curJ >= start && propJ >= start && cur[curJ] === prop[propJ]) {
    curJ--;
    propJ--;
  }

  return {
    start,
    oldEnd: curJ + 1,
    newEnd: propJ + 1,
    suffixKept: cur.length - 1 - curJ,
  };
}

/** Replacement text for the changed span (no trailing newline unless middle of file). */
export function replacementForSpan(
  proposed: string,
  span: LineEditSpan,
): string {
  const prop = splitLines(proposed);
  return prop.slice(span.start, span.newEnd).join('\n');
}
