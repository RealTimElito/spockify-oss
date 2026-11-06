/** Lowercase alphanumeric tokens for BM25. */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    const alnum =
      (c >= 48 && c <= 57) ||
      (c >= 97 && c <= 122) ||
      c === 95;
    if (alnum) {
      current += lower[i];
    } else if (current.length > 0) {
      if (current.length >= 2) {
        tokens.push(current);
      }
      current = '';
    }
  }
  if (current.length >= 2) {
    tokens.push(current);
  }
  return tokens;
}

export function termFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) {
    tf[t] = (tf[t] ?? 0) + 1;
  }
  return tf;
}

export function docLength(tf: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(tf)) {
    n += v;
  }
  return n;
}
