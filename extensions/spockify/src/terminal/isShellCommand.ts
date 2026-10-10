/**
 * Detect whether a terminal_run "command" is actually a shell command
 * vs markdown/prose the model dumped into the tool by mistake.
 */

/** Absolute max — even legitimate scripts rarely need more in one tool call. */
const MAX_COMMAND_CHARS = 4000;
/** Soft max for non-script one-liners / short blocks. */
const MAX_PROSE_CHARS = 800;
/** More blank-line paragraphs than this → essay, not a script. */
const MAX_PARAGRAPHS = 3;

const SHELL_META = /[|;&><`$(){}[\]\\]|&&|\|\|/;
const SHELL_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHEBANG = /^#!\s*\//;

/** Common argv0 / builtins — not exhaustive; presence is a positive signal. */
const SHELL_HEAD =
  /^(?:sudo|doas|env|command|builtin|time|nohup|nice|ionice|stdbuf|timeout|watch)?\s*(?:\.\/|[\w./-]+\/)?(?:ls|cd|pwd|echo|cat|head|tail|less|more|grep|rg|find|fd|awk|sed|sort|uniq|wc|cut|tr|tee|xargs|cp|mv|rm|mkdir|rmdir|touch|chmod|chown|ln|stat|file|du|df|ps|kill|top|htop|which|type|hash|alias|export|unset|source|\.|test|\[|true|false|exit|return|shift|read|printf|basename|dirname|realpath|mktemp|date|seq|yes|sleep|wait|jobs|fg|bg|disown|history|clear|reset|uname|whoami|id|hostname|curl|wget|ssh|scp|rsync|tar|gzip|gunzip|zip|unzip|git|gh|npm|npx|yarn|pnpm|bun|node|deno|python3?|pip3?|uv|poetry|cargo|rustc|go|make|cmake|ninja|gcc|g\+\+|clang|docker|podman|kubectl|helm|terraform|ansible|systemctl|journalctl|apt|apt-get|dnf|yum|pacman|brew|snap|flatpak|pipx|cargo|composer|bundle|gradle|mvn|dotnet|java|javac|ruby|perl|php|lua|R|julia|sqlite3|psql|mysql|redis-cli|mongosh|ollama|huggingface-cli|hf|jq|yq|bat|exa|eza|tree|nc|netcat|ping|dig|nslookup|ip|ifconfig|ss|lsof|strace|tcpdump|openssl|gpg|base64|sha256sum|md5sum|diff|patch|vim|nvim|nano|code|cursor|tmux|screen|fzf|ripgrep)\b/i;

const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+\S/m;
const MARKDOWN_LIST = /^\s{0,3}(?:[-*+]|\d+\.)\s+\S.*\n\s{0,3}(?:[-*+]|\d+\.)\s+/m;
const MARKDOWN_BOLD_ITALIC = /\*\*[^*\n]{3,}\*\*|__[^_\n]{3,}__/;

/** Sentence-y prose without shell shape. */
const PROSE_SENTENCE =
  /\b(?:in your|you (?:should|can|will|need to)|this (?:will|section|step)|integrate|background|tasks|following|example|note that|make sure|don't forget)\b/i;

export type ShellCommandCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Return whether `command` is plausible shell argv / a short script.
 * Used to refuse markdown plans and essays before policy ask / exec.
 */
export function checkShellCommand(command: string): ShellCommandCheck {
  const raw = String(command ?? '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Empty command.' };
  }
  if (trimmed.length > MAX_COMMAND_CHARS) {
    return {
      ok: false,
      reason: `Not a shell command: too long (${trimmed.length} chars; max ${MAX_COMMAND_CHARS}).`,
    };
  }

  // Markdown headings / doc structure — never a shell command.
  if (MARKDOWN_HEADING.test(trimmed)) {
    return {
      ok: false,
      reason:
        'Not a shell command: looks like markdown (heading). Use explore tools or write_file for plans/docs.',
    };
  }
  if (MARKDOWN_LIST.test(trimmed) && !SHELL_META.test(trimmed) && !SHELL_HEAD.test(trimmed)) {
    return {
      ok: false,
      reason:
        'Not a shell command: looks like a markdown list / plan. Do not paste prose into terminal_run.',
    };
  }
  if (
    MARKDOWN_BOLD_ITALIC.test(trimmed) &&
    !SHELL_META.test(trimmed) &&
    !SHELL_HEAD.test(firstMeaningfulLine(trimmed))
  ) {
    return {
      ok: false,
      reason: 'Not a shell command: markdown formatting without shell tokens.',
    };
  }

  const lines = trimmed.split(/\n/);
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length > MAX_PARAGRAPHS && !looksLikeScript(trimmed)) {
    return {
      ok: false,
      reason:
        'Not a shell command: multi-paragraph prose. terminal_run is for real argv/shell one-liners or short scripts only.',
    };
  }

  // Long essay without shell shape.
  if (trimmed.length > MAX_PROSE_CHARS && !looksLikeScript(trimmed) && !hasShellShape(trimmed)) {
    return {
      ok: false,
      reason:
        'Not a shell command: long prose without shell tokens. Do not paste plans/docs into terminal_run.',
    };
  }

  const head = firstMeaningfulLine(trimmed);
  if (SHEBANG.test(head) || SHEBANG.test(trimmed)) {
    return { ok: true };
  }

  // Positive shell signals win.
  if (hasShellShape(trimmed) || SHELL_HEAD.test(head) || SHELL_ASSIGN.test(head)) {
    return { ok: true };
  }

  // Multi-line block where most lines look command-like.
  if (nonEmpty.length >= 2 && looksLikeScript(trimmed)) {
    return { ok: true };
  }

  // Single short token that might be a binary name (e.g. "pwd", "htop").
  if (nonEmpty.length === 1 && /^[A-Za-z0-9_./+-]{1,64}$/.test(head)) {
    return { ok: true };
  }

  // Explicit prose cues + no shell → refuse.
  if (PROSE_SENTENCE.test(trimmed) || /[.!?]\s+[A-Z]/.test(trimmed)) {
    return {
      ok: false,
      reason:
        'Not a shell command: looks like documentation/prose. Prefer read_file/grep/write_file; use terminal_run only for real shell.',
    };
  }

  // Default: if it does not look like shell at all, refuse.
  if (!hasShellShape(trimmed) && !SHELL_HEAD.test(head)) {
    return {
      ok: false,
      reason:
        'Not a shell command: no shell-like tokens. Emit a real argv/one-liner, not plans or markdown.',
    };
  }

  return { ok: true };
}

/** Convenience boolean. */
export function looksLikeShellCommand(command: string): boolean {
  return checkShellCommand(command).ok;
}

function firstMeaningfulLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t;
  }
  return text.trim().split('\n')[0]?.trim() ?? '';
}

function hasShellShape(text: string): boolean {
  if (SHELL_META.test(text)) return true;
  // Flags are a strong signal: `ls -la`, `git status -sb`
  if (/(?:^|\s)-{1,2}[A-Za-z0-9]/.test(text)) return true;
  // Path-ish args
  if (/(?:^|\s)(?:\.\/|\.\.\/|~\/|\/)[\w./+-]+/.test(text)) return true;
  return false;
}

/** Heuristic: multi-line shell script vs essay. */
function looksLikeScript(text: string): boolean {
  if (SHEBANG.test(text.trim())) return true;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return false;
  let shellish = 0;
  for (const line of lines) {
    if (
      SHELL_HEAD.test(line) ||
      SHELL_META.test(line) ||
      SHELL_ASSIGN.test(line) ||
      /^(?:if|then|else|elif|fi|for|while|do|done|case|esac|function)\b/.test(line)
    ) {
      shellish += 1;
    }
  }
  return shellish >= Math.ceil(lines.length * 0.5);
}
