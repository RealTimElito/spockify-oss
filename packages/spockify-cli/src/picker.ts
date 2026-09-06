import { stdin as input, stdout as output } from 'node:process';
import { ansi, paintCols, truncateVisible } from './ui';

export type PickerItem<T extends string = string> = {
  value: T;
  label: string;
  hint?: string;
};

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Arrow-key list picker. Returns null if cancelled (esc).
 */
export async function pickFromList<T extends string>(options: {
  title: string;
  items: Array<PickerItem<T>>;
  current?: T;
}): Promise<T | null> {
  const { title, items } = options;
  if (!items.length) return null;

  let idx = items.findIndex((it) => it.value === options.current);
  if (idx < 0) idx = 0;

  const prevRaw = input.isTTY ? input.isRaw : false;
  let settled = false;
  let paintedLines = 0;

  const render = (): string => {
    const cols = paintCols();
    const lines: string[] = [
      '',
      truncateVisible(`  ${ansi.bold(title)}`, cols),
    ];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const mark = i === idx ? ansi.accent('❯') : ' ';
      const label = i === idx ? ansi.bold(it.label) : it.label;
      const hint = it.hint ? ansi.dim(` — ${it.hint}`) : '';
      const cur = it.value === options.current ? ansi.green(' ●') : '';
      lines.push(
        truncateVisible(`  ${mark} ${label}${cur}${hint}`, cols),
      );
    }
    lines.push(
      truncateVisible(ansi.dim('  ↑↓ move · enter select · esc cancel'), cols),
    );
    return lines.join('\n') + '\n';
  };

  const paint = () => {
    if (paintedLines > 0) {
      output.write(`\x1b[${paintedLines}A\x1b[1G\x1b[0J`);
    }
    const text = render();
    paintedLines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    // count newlines
    paintedLines = (text.match(/\n/g) || []).length;
    output.write(`\x1b[?25l${text}`);
  };

  const cleanup = () => {
    if (paintedLines > 0) {
      output.write(`\x1b[${paintedLines}A\x1b[1G\x1b[0J`);
    }
    output.write(`\x1b[?25h`);
  };

  return await new Promise<T | null>((resolve) => {
    let escArmed = false;

    const finish = (v: T | null) => {
      if (settled) return;
      settled = true;
      input.off('data', onData);
      cleanup();
      try {
        if (input.isTTY) input.setRawMode(prevRaw);
      } catch {
        /* ignore */
      }
      resolve(v);
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      const s = chunk.toString('utf8');

      // Ignore mouse during picker (parent may still have tracking on)
      if (s.includes('\x1b[<')) return;

      if (s === '\x1b[A' || s === 'k') {
        idx = (idx - 1 + items.length) % items.length;
        paint();
        return;
      }
      if (s === '\x1b[B' || s === 'j') {
        idx = (idx + 1) % items.length;
        paint();
        return;
      }
      if (s === '\r' || s === '\n') {
        finish(items[idx]!.value);
        return;
      }
      if (s.charCodeAt(0) === 3) {
        finish(null);
        return;
      }
      // Esc alone cancels; multi-byte CSI handled above
      if (s === '\x1b') {
        escArmed = true;
        setTimeout(() => {
          if (escArmed) finish(null);
        }, 50);
        return;
      }
      escArmed = false;

      const n = Number(s);
      if (n >= 1 && n <= items.length) {
        finish(items[n - 1]!.value);
      }
    };

    try {
      if (input.isTTY) input.setRawMode(true);
    } catch {
      /* ignore */
    }
    input.resume();
    paint();
    void visibleLen;
    input.on('data', onData);
  });
}
