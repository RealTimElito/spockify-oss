import { DEFAULT_MODEL } from './config';
import { ansi } from './ui';

export interface ModelPreset {
  id: string;
  aliases: string[];
  blurb: string;
}

/** Curated models people actually want from the CLI. */
export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'spockify-auto',
    aliases: ['auto'],
    blurb: 'Auto-route · search when needed · picks a worker',
  },
  {
    id: DEFAULT_MODEL,
    aliases: ['oss', 'default', 'coding'],
    blurb: 'Coding agent (default)',
  },
  {
    id: 'codestral',
    aliases: ['code'],
    blurb: 'Code generation',
  },
  {
    id: 'web-codestral',
    aliases: ['web'],
    blurb: 'Codestral + web search',
  },
  {
    id: 'web-gemma',
    aliases: ['gemma'],
    blurb: 'Gemma 4 + web search',
  },
  {
    id: 'spockify-room',
    aliases: ['room'],
    blurb: 'Multi-agent room (researcher · coder · critic)',
  },
  {
    id: 'spockify-agents',
    aliases: ['agents'],
    blurb: 'Parallel agents + synthesis',
  },
];

const META = new Set(['', 'list', 'ls', 'help', '?', 'show']);

export function isModelMetaCommand(arg: string): boolean {
  return META.has(arg.trim().toLowerCase());
}

/** Resolve alias / id → canonical model id, or null if unknown preset. */
export function resolveModelId(input: string): string | null {
  const raw = input.trim();
  if (!raw || isModelMetaCommand(raw)) return null;
  const key = raw.toLowerCase();
  for (const p of MODEL_PRESETS) {
    if (p.id.toLowerCase() === key) return p.id;
    if (p.aliases.some((a) => a.toLowerCase() === key)) return p.id;
  }
  // Allow any other id the API might know (custom / litellm)
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(raw)) return raw;
  return null;
}

export function renderModelHelp(current: string): string {
  const lines = [
    `${ansi.bold('  Models')}  ${ansi.dim(`current: ${current}`)}`,
    '',
    ...MODEL_PRESETS.map((p) => {
      const mark = p.id === current ? ansi.green('●') : ansi.dim('○');
      const alias =
        p.aliases.length > 0
          ? ansi.dim(`  (${p.aliases.join(', ')})`)
          : '';
      return `  ${mark} ${ansi.cyan(p.id)}${alias}\n      ${ansi.dim(p.blurb)}`;
    }),
    '',
    ansi.dim('  /model              show this list'),
    ansi.dim('  /model list         same'),
    ansi.dim('  /model auto         use spockify-auto'),
    ansi.dim('  /model <id>         switch model'),
  ];
  return `\n${lines.join('\n')}\n`;
}
