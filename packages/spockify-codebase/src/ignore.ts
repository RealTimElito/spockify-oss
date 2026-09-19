import * as path from 'node:path';

interface IgnoreRule {
  /** Relative pattern as stored in file. */
  raw: string;
  negated: boolean;
  onlyDir: boolean;
  /** Pattern anchored to repo root (leading /). */
  anchored: boolean;
  regex: RegExp;
}

const DEFAULT_IGNORE = [
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  '.spockify/',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.webp',
  '*.ico',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.zip',
  '*.tar',
  '*.gz',
  '*.7z',
  '*.pdf',
  '*.wasm',
  '*.exe',
  '*.dll',
  '*.so',
  '*.dylib',
  '*.class',
  '*.jar',
  '*.lock',
  'package-lock.json',
];

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a gitignore-style pattern to a RegExp tested against relative paths
 * (forward slashes, no leading slash unless anchored).
 */
function patternToRegex(pattern: string, anchored: boolean): RegExp {
  let p = pattern.replace(/\\/g, '/');
  if (p.startsWith('/')) {
    p = p.slice(1);
  }
  let regex = '';
  if (anchored) {
    regex += '^';
  } else if (!p.includes('/')) {
    regex += '(^|.*/)';
  } else {
    regex += '^';
  }

  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        regex += '.*';
        i++;
        if (p[i + 1] === '/') {
          i++;
        }
      } else {
        regex += '[^/]*';
      }
    } else if (c === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegex(c);
    }
  }
  regex += '($|/)';
  return new RegExp(regex);
}

function parseLine(line: string): IgnoreRule | null {
  let raw = line.trim();
  if (!raw || raw.startsWith('#')) {
    return null;
  }
  let negated = false;
  if (raw.startsWith('!')) {
    negated = true;
    raw = raw.slice(1).trim();
  }
  if (!raw) {
    return null;
  }
  let onlyDir = false;
  if (raw.endsWith('/')) {
    onlyDir = true;
    raw = raw.slice(0, -1);
  }
  const anchored = raw.startsWith('/');
  if (anchored) {
    raw = raw.slice(1);
  }
  return {
    raw,
    negated,
    onlyDir,
    anchored,
    regex: patternToRegex(raw, anchored),
  };
}

export class IgnoreMatcher {
  private rules: IgnoreRule[] = [];

  constructor(extraPatterns: string[] = []) {
    for (const p of DEFAULT_IGNORE) {
      const rule = parseLine(p);
      if (rule) {
        this.rules.push(rule);
      }
    }
    for (const p of extraPatterns) {
      const rule = parseLine(p);
      if (rule) {
        this.rules.push(rule);
      }
    }
  }

  addGitignoreContent(content: string): void {
    for (const line of content.split(/\r?\n/)) {
      const rule = parseLine(line);
      if (rule) {
        this.rules.push(rule);
      }
    }
  }

  /** Whether path relative to workspace root should be skipped. */
  ignores(relativePath: string, isDirectory: boolean): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized) {
      return false;
    }
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.onlyDir && !isDirectory) {
        continue;
      }
      if (rule.regex.test(normalized)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

export async function loadIgnoreFiles(
  root: string,
  readFile: (p: string) => Promise<string>,
  exists: (p: string) => Promise<boolean>,
): Promise<IgnoreMatcher> {
  const matcher = new IgnoreMatcher();
  for (const name of ['.gitignore', '.spockifyignore']) {
    const full = path.join(root, name);
    if (await exists(full)) {
      try {
        const content = await readFile(full);
        matcher.addGitignoreContent(content);
      } catch {
        // skip unreadable ignore file
      }
    }
  }
  return matcher;
}
