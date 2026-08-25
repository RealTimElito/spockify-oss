import { stdin as input } from 'node:process';
import type { ExitKey } from './exitGuard';
import {
  disableMouseTracking,
  finishBoxedPrompt,
  paintBoxedPrompt,
  type SessionUiState,
} from './ui';

export type RawLineResult = 'exit' | 'retry' | string;

/**
 * Boxed prompt reader: redraws the whole chrome on each key so the cursor
 * stays inside the box (works in VS Code’s terminal; no DECSC).
 */
export async function readBoxedLine(options: {
  state: () => SessionUiState;
  onInterrupt: (key: ExitKey) => boolean | Promise<boolean>;
  shouldExit: () => boolean;
}): Promise<RawLineResult> {
  // Ensure a previous mouse-tracking session can't leave the terminal weird
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
    let buf = '';
    let painted = false;
    let settled = false;
    let leftChrome = false;
    const prevRaw = input.isRaw;

    const paint = () => {
      paintBoxedPrompt(options.state(), buf, { repaint: painted });
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
      const s = chunk.toString('utf8');

      for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        const code = ch.charCodeAt(0);

        if (code === 3) {
          interrupt('Ctrl+C');
          return;
        }
        if (code === 4) {
          if (buf.length === 0) {
            interrupt('Ctrl+D');
          }
          return;
        }
        if (ch === '\r' || ch === '\n') {
          finish(buf);
          return;
        }
        if (ch === '\x7f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            paint();
          }
          continue;
        }
        if (ch === '\x1b') {
          // Drop escape sequences (arrows, focus events, leftover mouse/CPR)
          break;
        }
        if (ch === '\t') {
          buf += '  ';
          paint();
          continue;
        }
        if (code >= 32) {
          buf += ch;
          paint();
        }
      }
    };

    try {
      input.setRawMode(true);
    } catch {
      /* ignore */
    }
    input.resume();
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
    let buf = '';
    let settled = false;
    const prevRaw = input.isRaw;

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
      const s = chunk.toString('utf8');
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        const code = ch.charCodeAt(0);
        if (code === 3) {
          void Promise.resolve(options.onInterrupt('Ctrl+C')).then((exit) => {
            finish(exit || options.shouldExit() ? 'exit' : 'retry');
          });
          return;
        }
        if (code === 4) {
          if (buf.length === 0) {
            void Promise.resolve(options.onInterrupt('Ctrl+D')).then((exit) => {
              finish(exit || options.shouldExit() ? 'exit' : 'retry');
            });
          }
          return;
        }
        if (ch === '\r' || ch === '\n') {
          finish(buf);
          return;
        }
        if (ch === '\x7f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch === '\x1b') break;
        if (code >= 32) {
          buf += ch;
          process.stdout.write(ch);
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
