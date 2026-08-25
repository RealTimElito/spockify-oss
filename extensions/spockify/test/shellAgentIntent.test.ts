import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractShellCommand,
  hasMultiAgentSpawnIntent,
  preferTerminalForPrompt,
  shellWorkerCount,
  shouldAutoSpawnAgentRun,
} from '../src/runtime/tools/shellAgentIntent';

describe('shellAgentIntent', () => {
  it('detects ping/curl prompts for local terminal', () => {
    assert.equal(
      preferTerminalForPrompt('Have two agents ping google.com 20 times'),
      true,
    );
    assert.equal(preferTerminalForPrompt('compare flask vs fastapi'), false);
  });

  it('extracts ping -c N host', () => {
    assert.equal(
      extractShellCommand('Ping google.com 10 times and report success'),
      'ping -c 10 google.com',
    );
  });

  it('parses worker count from natural language', () => {
    assert.equal(shellWorkerCount('two agents ping google.com'), 2);
    assert.equal(shellWorkerCount('4 agents curl example.com'), 4);
    assert.equal(shellWorkerCount('have three agents research X'), 3);
  });

  it('auto-spawns on explicit multi-agent / parallel language', () => {
    assert.equal(
      shouldAutoSpawnAgentRun(
        'Have two agents ping google.com 20 times and they should run in parallel',
      ),
      true,
    );
    assert.equal(
      shouldAutoSpawnAgentRun('spawn agents to research flask vs fastapi'),
      true,
    );
    assert.equal(
      hasMultiAgentSpawnIntent('ping google.com in parallel'),
      true,
    );
  });

  it('does not auto-spawn ordinary coding or single-ping chats', () => {
    assert.equal(shouldAutoSpawnAgentRun('fix the auth bug'), false);
    assert.equal(shouldAutoSpawnAgentRun('what does this agent loop do?'), false);
    assert.equal(
      shouldAutoSpawnAgentRun('WHat does this code do?'),
      false,
    );
    assert.equal(
      shouldAutoSpawnAgentRun('ping google.com 10 times'),
      false,
    );
    // @context after --- must not false-positive on docs mentioning agents.
    assert.equal(
      shouldAutoSpawnAgentRun(
        'What does this code do?\n\n---\n[@selection]\nspawn agents in parallel for research',
      ),
      false,
    );
  });
});
