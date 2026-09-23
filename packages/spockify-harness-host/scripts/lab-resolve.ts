#!/usr/bin/env npx tsx
/**
 * Lab → same yaml resolver as CLI/IDE.
 * Prints one JSON line: {id, kernel, wanted, command, fallback}.
 * Missing plugin command → kernel + fallback reason (caller must not hang).
 */
import { resolveHarnessOrFallback } from '../src/index';

const cwd = process.argv[2] || process.cwd();
const r = resolveHarnessOrFallback(undefined, cwd);
process.stdout.write(
  `${JSON.stringify({
    id: r.harness.id,
    kernel: r.harness.id === 'spockify',
    wanted: r.wanted,
    command: r.harness.command,
    fallback: r.fallbackReason || null,
  })}\n`,
);
