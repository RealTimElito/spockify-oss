import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatPlanStrip,
  formatSwarmWorkerLine,
  serializeAsk,
} from '../src/agent/planStrip';

describe('plan strip', () => {
  it('prints the same statuses the IDE todo strip uses', () => {
    const text = formatPlanStrip([
      { status: 'completed', content: 'Read the file' },
      { status: 'in_progress', content: 'Edit it' },
      { status: 'pending', content: 'Run tests' },
      { status: 'cancelled', content: 'Skip docs' },
    ]);
    assert.match(text, /^Plan\n/);
    assert.match(text, /✓ Read the file/);
    assert.match(text, /• Edit it/);
    assert.match(text, /○ Run tests/);
    assert.match(text, /– Skip docs/);
    assert.equal(formatPlanStrip([]), '');
  });

  it('keeps a failed swarm worker error on the status line', () => {
    assert.equal(
      formatSwarmWorkerLine({
        title: 'Pytest',
        state: 'failed',
        statusLabel: 'failed',
        error: 'assertion failed',
      }),
      'Pytest: failed — assertion failed',
    );
    assert.equal(
      formatSwarmWorkerLine({ title: 'Reader', state: 'cancelled', statusLabel: 'stopped' }),
      'Reader: stopped',
    );
  });

  it('asks one question at a time', async () => {
    const order: string[] = [];
    const ask = serializeAsk(async (prompt) => {
      order.push(`start ${prompt}`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end ${prompt}`);
      return prompt;
    });
    const [a, b] = await Promise.all([ask('one'), ask('two')]);
    assert.deepEqual(order, ['start one', 'end one', 'start two', 'end two']);
    assert.equal(a, 'one');
    assert.equal(b, 'two');
  });
});
