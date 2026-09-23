import { stdin as input, stdout as output } from 'node:process';
import type { ExitKey } from './exitGuard';
import {
  KeyParser,
  applyComposerKey,
  composerText,
  createComposer,
  deleteCharLeft,
  pushHistory,
  segmentGraphemes,
  setComposerText,
  type ComposerState,
} from './composerBuffer';
import {
  boxedInputContentWidth,
  disableMouseTracking,
  finishBoxedPrompt,
  paintBoxedPrompt,
  type SessionUiState,
} from './ui';
import {
  CODING_SLASH_COMMANDS,
  EVAL_SLASH_COMMANDS,
  filterSlashCommands,
  slashMenuQuery,
  type SlashCommand,
} from './slash';

export type RawLineResult = 'exit' | 'retry' | string;

/** Shared across REPL turns so ↑/↓ recall prior prompts. */
const sharedInputHistory: string[] = [];

/**
 * Boxed prompt reader: redraws the whole chrome on each key so the cursor
 * stays inside the box (works in VS Code’s terminal; no DECSC).
 *
 * Keys (raw TTY):
 * - Left/Right · Home/End — caret (Home/End = visual line)
 * - Up/Down — wrapped lines first, then input history
 * - Ctrl+Left/Right — word motion (tmux may bind Ctrl+Left; use Alt+Left
 *   if your terminal sends it, or unbind in tmux)
 * - Ctrl+Backspace / Ctrl+W / Alt+Backspace — delete previous word
 * - Ctrl+Delete — delete next word
 * - Enter — submit · Shift+Enter or Esc+Enter — newline
 * - Ctrl+C / Ctrl+D — cancel / EOF (unchanged)
 */
export async function readBoxedLine(options: {
  state: () => SessionUiState;
  onInterrupt: (key: ExitKey) => boolean | Promise<boolean>;
  shouldExit: () => boolean;
}): Promise<RawLineResult> {
  disableMouseTracking();

  if (!input.isTTY) {
    paintBoxedPrompt(options.state(), '');
    return await new Promise<RawLineResult>((resolve) => {
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\n')) {
          input.off('data', onData);
          finishBoxedPrompt();
          resolve(buf.replace(/\r?\n.*/, ''));
        }
      };
      input.on('data', onData);
    });
  }

  return await new Promise<RawLineResult>((resolve) => {
    const composer: ComposerState = createComposer(sharedInputHistory);
    let painted = false;
    let settled = false;
    let leftChrome = false;
    let slashIdx = 0;
    const prevRaw = input.isRaw;
    const parser = new KeyParser();

    const slashHits = (): SlashCommand[] => {
      const query = slashMenuQuery(composerText(composer));
      if (query == null) return [];
      const cmds = options.state().evalMode ? EVAL_SLASH_COMMANDS : CODING_SLASH_COMMANDS;
      return filterSlashCommands(query, cmds);
    };

    const paint = () => {
      const items = slashHits();
      if (slashIdx >= items.length) slashIdx = Math.max(0, items.length - 1);
      paintBoxedPrompt(options.state(), composerText(composer), {
        repaint: painted,
        caret: composer.caret,
        scrollTop: composer.scrollTop,
        slashItems: items,
        slashSelected: slashIdx,
      });
      painted = true;
    };

    const leaveChrome = () => {
      if (painted && !leftChrome) {
        finishBoxedPrompt();
        leftChrome = true;
      }
    };

    const finish = (v: RawLineResult) => {
      if (settled) return;
      settled = true;
      input.off('data', onData);
      try {
        output.write('\x1b[?2004l');
      } catch {
        /* ignore */
      }
      try {
        input.setRawMode(prevRaw);
      } catch {
        /* ignore */
      }
      if (v !== 'exit' && v !== 'retry') {
        paintBoxedPrompt(options.state(), v, {
          repaint: painted && !leftChrome,
          submitted: true,
        });
        painted = true;
        leaveChrome();
        pushHistory(sharedInputHistory, v);
      } else {
        leaveChrome();
      }
      resolve(v);
    };

    const interrupt = (key: ExitKey) => {
      leaveChrome();
      void Promise.resolve(options.onInterrupt(key)).then((exit) => {
        finish(exit || options.shouldExit() ? 'exit' : 'retry');
      });
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      const keys = parser.push(chunk.toString('utf8'));
      const width = boxedInputContentWidth();
      let dirty = false;

      for (const key of keys) {
        if (key.type === 'ctrlC') {
          interrupt('Ctrl+C');
          return;
        }
        if (key.type === 'ctrlD') {
          if (composer.graphemes.length === 0) {
            interrupt('Ctrl+D');
          }
          return;
        }
        if (key.type === 'enter') {
          const items = slashHits();
          const text = composerText(composer);
          if (items.length && slashMenuQuery(text) != null) {
            finish(items[slashIdx]?.name || text);
            return;
          }
          finish(text);
          return;
        }
        const menu = slashHits();
        if (menu.length && (key.type === 'up' || key.type === 'down' || key.type === 'tab')) {
          if (key.type === 'tab') {
            const pick = menu[slashIdx];
            if (pick) setComposerText(composer, pick.name);
          } else {
            slashIdx =
              key.type === 'down'
                ? (slashIdx + 1) % menu.length
                : (slashIdx - 1 + menu.length) % menu.length;
          }
          dirty = true;
          continue;
        }
        applyComposerKey(composer, key, width);
        if (key.type === 'char' || key.type === 'backspace' || key.type === 'paste') {
          slashIdx = 0;
        }
        dirty = true;
      }
      if (dirty) paint();
    };

    try {
      input.setRawMode(true);
    } catch {
      /* ignore */
    }
    input.resume();
    try {
      output.write('\x1b[?2004h');
    } catch {
      /* ignore */
    }
    paint();
    input.on('data', onData);
  });
}

/** Plain one-line raw reader (permission prompts). */
export async function readLineRaw(options: {
  onInterrupt: (key: ExitKey) => boolean | Promise<boolean>;
  shouldExit: () => boolean;
}): Promise<RawLineResult> {
  if (!input.isTTY) {
    return await new Promise<RawLineResult>((resolve) => {
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\n')) {
          input.off('data', onData);
          resolve(buf.replace(/\r?\n.*/, ''));
        }
      };
      input.on('data', onData);
    });
  }

  return await new Promise<RawLineResult>((resolve) => {
    let graphemes = segmentGraphemes('');
    let settled = false;
    const prevRaw = input.isRaw;
    const parser = new KeyParser();

    const finish = (v: RawLineResult) => {
      if (settled) return;
      settled = true;
      input.off('data', onData);
      try {
        input.setRawMode(prevRaw);
      } catch {
        /* ignore */
      }
      process.stdout.write('\n');
      resolve(v);
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      const keys = parser.push(chunk.toString('utf8'));
      for (const key of keys) {
        if (key.type === 'ctrlC') {
          void Promise.resolve(options.onInterrupt('Ctrl+C')).then((exit) => {
            finish(exit || options.shouldExit() ? 'exit' : 'retry');
          });
          return;
        }
        if (key.type === 'ctrlD') {
          if (graphemes.length === 0) {
            void Promise.resolve(options.onInterrupt('Ctrl+D')).then((exit) => {
              finish(exit || options.shouldExit() ? 'exit' : 'retry');
            });
          }
          return;
        }
        if (key.type === 'enter') {
          finish(graphemes.join(''));
          return;
        }
        if (key.type === 'backspace') {
          if (graphemes.length > 0) {
            const st = createComposer();
            st.graphemes = graphemes.slice();
            st.caret = graphemes.length;
            deleteCharLeft(st);
            graphemes = st.graphemes;
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (key.type === 'char') {
          graphemes.push(...segmentGraphemes(key.ch));
          process.stdout.write(key.ch);
          continue;
        }
        if (key.type === 'paste') {
          const parts = segmentGraphemes(key.text);
          graphemes.push(...parts);
          process.stdout.write(key.text);
        }
      }
    };

    try {
      input.setRawMode(true);
    } catch {
      /* ignore */
    }
    input.resume();
    input.on('data', onData);
  });
}
