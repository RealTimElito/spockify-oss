/**
 * Checkpoint index parsing (no vscode).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseCheckpointIndex,
  sanitizeCheckpointId,
} from '../src/checkpoints/persistenceCore';

describe('checkpoints persistence', () => {
  it('sanitizeCheckpointId accepts apply + manual ids', () => {
    assert.equal(sanitizeCheckpointId('cp_a1b2c3d4e5f6'), 'cp_a1b2c3d4e5f6');
    assert.equal(
      sanitizeCheckpointId('cp_manual_lxyz'),
      'cp_manual_lxyz',
    );
  });

  it('sanitizeCheckpointId rejects path traversal', () => {
    assert.throws(() => sanitizeCheckpointId('../etc/passwd'));
    assert.throws(() => sanitizeCheckpointId('cp_bad/id'));
  });

  it('parseCheckpointIndex filters invalid ids', () => {
    const ids = parseCheckpointIndex(
      JSON.stringify({
        version: 1,
        ids: ['cp_ok123', 'nope', 'cp_also_ok', 42],
      }),
    );
    assert.deepEqual(ids, ['cp_ok123', 'cp_also_ok']);
  });
});
