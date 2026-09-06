/**
 * Pure helpers for AI-generated conventional commit messages.
 */

/** Soft cap so chat/completions stay within context. */
export const MAX_DIFF_CHARS = 48_000;

/**
 * System prompt for Generate Commit Message.
 * Keep discipline tight: models otherwise laundry-list files and meta-narrate.
 */
export const COMMIT_MESSAGE_SYSTEM = [
  'You write git commit messages in Conventional Commits format.',
  'Reply with ONLY the commit message text — no preamble, analysis, markdown fences, or quotes.',
  '',
  'Format (exactly):',
  '  type(optional-scope): imperative subject',
  '  <blank line>',
  '  optional short body (at most 2 lines)',
  '',
  'Types: feat, fix, refactor, docs, test, chore, perf, build, ci, style.',
  'Subject: ≤72 chars, imperative mood ("add" not "added"/"adds"), no trailing period.',
  'One subject that captures the dominant why/intent of the whole change.',
  '',
  'GOOD examples (emit this shape only):',
  '  chore: tighten generate-commit-message prompts and bump IDE to 0.9.5',
  '  feat(auth): add OAuth login for IDE sessions',
  '  fix: prevent empty SCM commit message toast',
  '',
  'BAD examples (never emit):',
  '  We need to craft a commit message…',
  '  The diff includes many updates:',
  '  - Bump version…',
  '  - Update generateCommitMessage.ts…',
  '  Thus this commit is a feature…',
  '',
  'Do NOT laundry-list files, paths, version bumps, or PATCHES notes.',
  'Do NOT hedge types ("could be feat or chore") — pick one.',
  'Do NOT write meta narration or bullet inventories.',
  'Body only when needed; subject alone is usually enough.',
  'When recent commit subjects are provided, match their brevity and style.',
].join('\n');

/** Second-pass rewrite when the model narrates instead of committing. */
export const COMMIT_MESSAGE_REWRITE_SYSTEM = [
  'Rewrite the draft into ONE Conventional Commits message.',
  'Output ONLY: type(optional-scope): imperative subject',
  'Optionally one blank line and at most 2 short body lines.',
  'No preamble, bullets, analysis, markdown, or quotes.',
  'If the draft laundry-lists files/versions, summarize the dominant intent instead.',
  'Examples: chore: tighten commit-message generation | feat: add login | fix: handle empty diff',
].join(' ');

export interface CommitMessageContext {
  /** Staged or working-tree unified diff. */
  diff: string;
  /** Whether the diff came from the index (staged). */
  staged: boolean;
  /** Optional recent subject lines for style. */
  recentSubjects?: string[];
  branchName?: string;
  repoName?: string;
}

export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return (
    diff.slice(0, maxChars) +
    `\n\n… [diff truncated at ${maxChars} chars]`
  );
}

export function buildCommitMessageUserPrompt(
  ctx: CommitMessageContext,
): string {
  const parts: string[] = [];
  if (ctx.repoName) {
    parts.push(`Repository: ${ctx.repoName}`);
  }
  if (ctx.branchName) {
    parts.push(`Branch: ${ctx.branchName}`);
  }
  parts.push(
    ctx.staged
      ? 'Diff scope: staged changes (index).'
      : 'Diff scope: unstaged working tree (nothing was staged).',
  );
  if (ctx.recentSubjects?.length) {
    parts.push(
      'Recent commit subjects (match this style):\n' +
        ctx.recentSubjects.map((s) => `- ${s}`).join('\n'),
    );
  }
  parts.push('Diff:\n```diff\n' + truncateDiff(ctx.diff) + '\n```');
  parts.push(
    [
      'Write the commit message now.',
      'Output ONLY one line: type: subject',
      '(optional blank line + short body).',
      'No bullets. No "We need to…". No file laundry list.',
    ].join(' '),
  );
  return parts.join('\n\n');
}

export function buildCommitMessageRewritePrompt(
  draft: string,
  diffExcerpt?: string,
): string {
  const parts = [
    'Draft (invalid — rewrite to Conventional Commits only):',
    '```',
    draft.trim().slice(0, 2000),
    '```',
  ];
  if (diffExcerpt?.trim()) {
    parts.push(
      'Diff context (for intent only):\n```diff\n' +
        truncateDiff(diffExcerpt, 8_000) +
        '\n```',
    );
  }
  parts.push(
    'Reply with ONLY: type: subject (optional short body). No bullets or preamble.',
  );
  return parts.join('\n\n');
}

const CONVENTIONAL_SUBJECT =
  /^(feat|fix|refactor|docs|test|chore|perf|build|ci|style)(\([^)]+\))?!?:\s+\S/;

const META_LINE =
  /^(thus\b|this commit\b|this is (a |an )?(feature|fix|chore|refactor)|could be\b|the changes?\b|changes include\b|summary\s*:|commit message\s*:|we need to\b|i('ll| will)\b|let me\b|here('s| is)\b|the diff includes?\b|overall intent\b|make it work\b)/i;

const BULLET_LINE = /^\s*([-*•]|\d+[.)])\s+/;

/**
 * True when text looks like meta-narration / laundry-list rather than a commit.
 */
export function looksLikeCommitNarration(text: string): boolean {
  const cleaned = (text || '').trim();
  if (!cleaned) {
    return true;
  }
  const lines = cleaned.split(/\r?\n/).map((l) => l.trimEnd());
  const first = (lines[0] || '').trim();
  if (!CONVENTIONAL_SUBJECT.test(first)) {
    return true;
  }
  const bullets = lines.filter((l) => BULLET_LINE.test(l.trim())).length;
  if (bullets >= 2) {
    return true;
  }
  const lower = cleaned.toLowerCase();
  if (
    /we need to craft|the diff includes|laundry.?list|overall intent:|changes:/.test(
      lower,
    )
  ) {
    return true;
  }
  return false;
}

export function isValidConventionalCommit(text: string): boolean {
  const cleaned = (text || '').trim();
  if (!cleaned || looksLikeCommitNarration(cleaned)) {
    return false;
  }
  return CONVENTIONAL_SUBJECT.test(cleaned.split(/\r?\n/)[0]!.trim());
}

/**
 * Last-resort deterministic rewrite from narration / bullets / version bumps.
 */
export function rewriteNarrationToConventional(raw: string): string {
  const text = (raw || '').trim();
  if (!text) {
    return '';
  }
  if (isValidConventionalCommit(text)) {
    return cleanCommitMessage(text);
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines
    .filter((l) => BULLET_LINE.test(l))
    .map((l) => l.replace(BULLET_LINE, '').trim())
    .filter(Boolean);

  const blob = (bullets.length ? bullets.join(' ') : text).toLowerCase();
  let type = 'chore';
  if (/\bfix\b|\bbug\b|\bprevent\b|\bhandle empty\b/.test(blob)) {
    type = 'fix';
  } else if (/\bfeat\b|\badd\b|\bimplement\b|\bnew\b/.test(blob) && !/\bbump\b/.test(blob)) {
    type = 'feat';
  } else if (/\brefactor\b/.test(blob)) {
    type = 'refactor';
  } else if (/\bdocs?\b|\breadme\b/.test(blob)) {
    type = 'docs';
  } else if (/\btest\b|\bspec\b/.test(blob)) {
    type = 'test';
  }

  const toVersion = blob.match(/\bto\s+(\d+\.\d+\.\d+)\b/);
  const allVersions = [...blob.matchAll(/\b(\d+\.\d+\.\d+)\b/g)].map((m) => m[1]!);
  const version =
    toVersion?.[1] ||
    (allVersions.length >= 2 ? allVersions[allVersions.length - 1] : allVersions[0]);
  let subject: string;
  if (
    /\bversion\b|\bbump\b/.test(blob) &&
    /\bcommit.?message\b|\bprompt\b|\bmax_tokens\b|\bscm\b/.test(blob)
  ) {
    subject = version
      ? `tighten commit-message generation and bump to ${version}`
      : 'tighten commit-message generation';
  } else if (/\bcommit.?message\b|\bprompt\b|\bmax_tokens\b/.test(blob)) {
    subject = 'tighten generate-commit-message prompts';
  } else if (/\bversion\b|\bbump\b/.test(blob) && version) {
    subject = `bump version to ${version}`;
  } else if (bullets[0]) {
    subject = bullets[0]
      .replace(/\.$/, '')
      .replace(/^(bump|update|extend|adjust|change|add|fix)\b/i, (m) =>
        m.toLowerCase(),
      )
      .slice(0, 72);
    // Prefer imperative without trailing inventory clauses.
    subject = subject.replace(/\s+across\b.*$/i, '').replace(/\s+in\b.*$/i, '');
    if (subject.length > 60) {
      subject = subject.slice(0, 60).replace(/\s+\S*$/, '');
    }
  } else {
    subject = 'update project files';
  }

  subject = subject
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/\.$/, '')
    .trim();
  if (!subject) {
    subject = 'update project files';
  }
  // Imperative: drop leading "Updated"/"Bumps" style if present.
  subject = subject.replace(/^(updated|updates|bumped|bumps|extended|extends)\s+/i, (m) => {
    const base = m.trim().toLowerCase();
    if (base.startsWith('updat')) return 'update ';
    if (base.startsWith('bump')) return 'bump ';
    if (base.startsWith('extend')) return 'extend ';
    return m.toLowerCase();
  });

  return `${type}: ${subject}`.slice(0, 100);
}

/**
 * Strip model fluff (fences, quotes, leading "Commit message:", meta narration).
 * Rejects laundry-list narration when no conventional subject can be recovered.
 */
export function cleanCommitMessage(raw: string): string {
  let text = (raw || '').trim();
  if (!text) {
    return '';
  }

  const fence = /^```(?:text|commit|markdown)?\s*([\s\S]*?)\s*```$/m.exec(
    text,
  );
  if (fence?.[1]) {
    text = fence[1].trim();
  }

  text = text.replace(/^(?:commit\s*message\s*:)\s*/i, '');
  // Drop wrapping quotes on a single-line subject.
  if (!text.includes('\n') && /^["'`].*["'`]$/.test(text)) {
    text = text.slice(1, -1).trim();
  }

  // Keep subject + optional body; drop trailing whitespace per line.
  let lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  while (lines.length && !lines[0]?.trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1]?.trim()) {
    lines.pop();
  }

  // If the model narrated before a Conventional Commits subject, keep from that line.
  const subjectIdx = lines.findIndex((l) => CONVENTIONAL_SUBJECT.test(l.trim()));
  if (subjectIdx > 0) {
    lines = lines.slice(subjectIdx);
  }

  // Drop leading meta narration when no conventional subject was found either.
  while (lines.length && META_LINE.test(lines[0]!.trim())) {
    lines.shift();
    while (lines.length && !lines[0]?.trim()) {
      lines.shift();
    }
  }

  // Drop trailing meta paragraphs after a blank line following the subject/body.
  if (lines.length > 2) {
    const out: string[] = [];
    let blankSeen = false;
    for (const line of lines) {
      if (!line.trim()) {
        if (out.length) blankSeen = true;
        out.push(line);
        continue;
      }
      if (blankSeen && (META_LINE.test(line.trim()) || BULLET_LINE.test(line.trim()))) {
        break;
      }
      // Soft-cap body: stop after ~3 non-empty lines total.
      const nonEmpty = out.filter((l) => l.trim()).length;
      if (nonEmpty >= 3 && blankSeen) {
        break;
      }
      out.push(line);
    }
    lines = out;
    while (lines.length && !lines[lines.length - 1]?.trim()) {
      lines.pop();
    }
  }

  let result = lines.join('\n').trim();

  // Still narration / bullet inventory → deterministic rewrite.
  if (looksLikeCommitNarration(result)) {
    result = rewriteNarrationToConventional(raw);
  }

  return result;
}

export function isEmptyDiff(diff: string | undefined | null): boolean {
  return !(diff || '').trim();
}
