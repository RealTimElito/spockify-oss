/** Terminal disposition: never infer verified from assistant prose. */

export type TerminalDisposition =
  | 'verified'
  | 'unverified'
  | 'blocked'
  | 'cancelled'
  | 'exhausted'
  | 'failed';

export type VerifierRecord = {
  command: string;
  ok: boolean;
  exit?: string;
  at: number;
};

export class VerificationLedger {
  readonly records: VerifierRecord[] = [];

  note(rec: VerifierRecord): void {
    this.records.push(rec);
  }

  hasPassingVerifier(): boolean {
    return this.records.some((r) => r.ok);
  }

  lastOk(): boolean {
    const last = this.records[this.records.length - 1];
    return Boolean(last?.ok);
  }
}

export function resolveDisposition(opts: {
  cancelled?: boolean;
  exhausted?: boolean;
  failed?: boolean;
  blocked?: boolean;
  ledger: VerificationLedger;
}): TerminalDisposition {
  if (opts.failed) return 'failed';
  if (opts.cancelled) return 'cancelled';
  if (opts.blocked) return 'blocked';
  if (opts.exhausted) return 'exhausted';
  if (opts.ledger.hasPassingVerifier() && opts.ledger.lastOk()) {
    return 'verified';
  }
  return 'unverified';
}

const DISPOSITIONS = new Set<string>([
  'verified',
  'unverified',
  'blocked',
  'cancelled',
  'exhausted',
  'failed',
]);

/** CLI and IDE must derive the same terminal reason from a done event. */
export function doneReason(ev: {
  cancelled?: boolean;
  reason?: TerminalDisposition | string;
}): TerminalDisposition {
  if (typeof ev.reason === 'string' && DISPOSITIONS.has(ev.reason)) {
    return ev.reason as TerminalDisposition;
  }
  if (ev.cancelled) return 'cancelled';
  return 'unverified';
}
