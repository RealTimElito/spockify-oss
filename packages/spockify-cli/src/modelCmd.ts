import { promoteLabModelHint, unpublishedLabModels } from '@spockify/harness';
import { ansi } from './ui';

/** Catalog hook only — does not pull weights or change prod pins. */
export function runModelCmd(args: string[]): number {
  const sub = (args[0] || 'help').toLowerCase();
  if (sub === 'lab' || sub === 'list' || sub === 'ls') {
    const rows = unpublishedLabModels();
    console.log(
      `${ansi.bold('Lab candidates')}  ${ansi.dim('promoted:false · not prod pins')}`,
    );
    if (!rows.length) {
      console.log('  (none)');
      return 0;
    }
    for (const r of rows) {
      const warn =
        r.id === 'devstral-2' ? ansi.yellow('  selecting evicts 120b-hot') : '';
      console.log(
        `  ${ansi.cyan(r.id)}  role=${r.role}  pool=${r.pool}  promoted=${r.promoted}${warn}`,
      );
    }
    console.log(
      ansi.dim(
        'Lab menu stays empty of weights until a fixture CARD exists. No pull.',
      ),
    );
    return 0;
  }
  if (sub === 'promote') {
    console.log(promoteLabModelHint(args[1]));
    return 0;
  }
  console.log('Usage: spockify model lab | spockify model promote');
  return sub === 'help' || sub === '-h' || sub === '--help' ? 0 : 1;
}
