import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAgentRunTranscript } from '../src/agents/agentRunTranscript';

describe('formatAgentRunTranscript', () => {
  it('prefers synthesis so follow-ups see ping output', () => {
    const text = formatAgentRunTranscript({
      heading: 'Local shell agents finished (2× `ping -c 3 google.com`):',
      synthesis:
        '### Runner 1 (ok)\n```\ntime=12.3 ms\n```\n\n### Runner 2 (ok)\n```\ntime=14.1 ms\n```',
    });
    assert.match(text, /time=12\.3 ms/);
    assert.match(text, /time=14\.1 ms/);
    assert.doesNotMatch(text, /See chat card/);
  });

  it('falls back to worker bodies when synthesis empty', () => {
    const text = formatAgentRunTranscript({
      heading: 'Parallel agents finished (done):',
      workers: [
        { name: 'A', state: 'done', result: 'rtt min/avg/max = 10/11/12' },
        { name: 'B', ok: false, error: 'timeout' },
      ],
    });
    assert.match(text, /rtt min\/avg\/max/);
    assert.match(text, /timeout/);
    assert.match(text, /### A \(ok\)/);
    assert.match(text, /### B \(failed\)/);
  });
});
