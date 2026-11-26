import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compactThread } from '../src/compactMessages';
import {
  appendDiagnostics,
  diagnosticsForFile,
} from '../src/fileDiagnostics';
import { registerHarnessTools } from '../src/tools';
import { ToolRegistry } from '../src/registry';
import {
  formatActivatedSkill,
  skillBodiesFromMessages,
} from '../src/skills';
import { todosFromMessages } from '../src/todos';
import type { AgentMessage } from '../src/types';

describe('session continuity', () => {
  it('restores todos from a tool result and from a compact summary', () => {
    const fromTool = todosFromMessages([
      {
        role: 'tool',
        name: 'todowrite',
        content: JSON.stringify([
          { id: '1', content: 'Edit parser', status: 'in_progress' },
        ]),
      },
    ]);
    assert.equal(fromTool[0]?.content, 'Edit parser');
    assert.equal(fromTool[0]?.status, 'in_progress');

    const packed = compactThread(
      [
        { role: 'user', content: 'task' },
        { role: 'tool', name: 'grep', toolCallId: 'g', content: 'z'.repeat(8000) },
        { role: 'user', content: 'latest' },
      ],
      {
        maxTokens: 50,
        keepRecent: 1,
        todos: fromTool,
        skillBodies: ['Playbook body'],
      },
    );
    const restored = todosFromMessages(packed.messages);
    assert.equal(restored[0]?.content, 'Edit parser');
    const skills = skillBodiesFromMessages(packed.messages);
    assert.deepEqual(skills, ['Playbook body']);
  });

  it('keeps an activated skill body for the next turn', () => {
    const content = formatActivatedSkill('review', 'Review', 'Check the diff.');
    const messages: AgentMessage[] = [
      { role: 'tool', name: 'activate_skill', toolCallId: 's', content },
    ];
    assert.deepEqual(skillBodiesFromMessages(messages), ['Check the diff.']);
  });
});

describe('edit diagnostics', () => {
  it('reports a broken JSON file and stays quiet when it parses', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spk-diag-'));
    await fs.writeFile(path.join(dir, 'bad.json'), '{', 'utf8');
    await fs.writeFile(path.join(dir, 'ok.json'), '{"a":1}', 'utf8');
    const bad = await diagnosticsForFile(dir, 'bad.json');
    const ok = await diagnosticsForFile(dir, 'ok.json');
    assert.equal(bad.length, 1);
    assert.match(bad[0]?.message || '', /JSON/i);
    assert.equal(ok.length, 0);
    assert.match(appendDiagnostics('Wrote bad.json', bad), /diagnostics:/);
  });

  it('ask_user returns the IDE or terminal answer', async () => {
    const registry = new ToolRegistry();
    registerHarnessTools(registry);
    const result = await registry.call(
      'ask_user',
      { prompt: 'Which file?' },
      {
        cwd: process.cwd(),
        mode: 'agent',
        yolo: true,
        askUser: async (prompt) => {
          assert.equal(prompt, 'Which file?');
          return 'src/app.ts';
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.content, 'src/app.ts');
  });
});
