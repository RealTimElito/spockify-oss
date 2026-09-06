/**
 * Multi-session tree for Terminal Agent (active + recent durable sessions).
 */

import * as vscode from 'vscode';
import {
  listActiveSessions,
  onActiveSessionsChanged,
  type ActiveTerminalSession,
} from './active';
import {
  listTerminalSessions,
  openSessionTranscriptDoc,
  type TerminalSessionSnapshot,
} from './store';

const VIEW_ID = 'spockify.terminalSessions';
export { VIEW_ID as TERMINAL_SESSIONS_VIEW_ID };

class SessionItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly kind: 'active' | 'history',
    readonly sessionId: string,
    description?: string,
    status?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `${kind}:${sessionId}`;
    this.description = description;
    this.contextValue = `spockify.terminalSession.${kind}.${status || 'done'}`;
    this.iconPath = new vscode.ThemeIcon(
      kind === 'active' ? 'play-circle' : 'history',
    );
    this.command = {
      command: 'spockify.terminalAgent.openSession',
      title: 'Open session',
      arguments: [sessionId, kind],
    };
  }
}

class HeaderItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly section: 'active' | 'recent',
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'spockify.terminalSession.header';
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor(msg: string) {
    super(msg, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'spockify.terminalSession.empty';
  }
}

type Node = SessionItem | HeaderItem | EmptyItem;

async function openActiveSessionDoc(s: ActiveTerminalSession): Promise<void> {
  const content = [
    `# Terminal Agent session (live)`,
    '',
    `**Goal:** ${s.goal}`,
    `**cwd:** ${s.cwd || '(none)'}`,
    `**Status:** ${s.status}`,
    `**Started:** ${new Date(s.startedAt).toISOString()}`,
    `**Updated:** ${new Date(s.updatedAt).toISOString()}`,
    s.planSteps?.length
      ? `**Plan:**\n${s.planSteps.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : '',
    s.sessionAllow.length
      ? `**Session allow:** ${s.sessionAllow.join(', ')}`
      : '',
    s.lastError ? `**Error:** ${s.lastError}` : '',
    '',
    '_Live status — full transcript is written when the run finishes (if openTranscript is on)._',
  ]
    .filter(Boolean)
    .join('\n');
  const doc = await vscode.workspace.openTextDocument({
    content,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

function sessionIdFromArg(
  arg?: string | SessionItem | vscode.TreeItem,
): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg instanceof SessionItem) return arg.sessionId;
  return undefined;
}

export class TerminalSessionsTreeProvider
  implements vscode.TreeDataProvider<Node>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    Node | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(onActiveSessionsChanged(() => this.refresh()));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Node[] {
    if (!element) {
      return [
        new HeaderItem('Active', 'active'),
        new HeaderItem('Recent', 'recent'),
      ];
    }
    if (!(element instanceof HeaderItem)) {
      return [];
    }
    if (element.section === 'active') {
      const active = listActiveSessions().filter(
        (s) =>
          s.status === 'planning' ||
          s.status === 'awaiting_plan' ||
          s.status === 'running',
      );
      if (!active.length) {
        return [new EmptyItem('No running sessions')];
      }
      return active.map((s) => this.fromActive(s));
    }
    const history = listTerminalSessions(this.context).slice(0, 12);
    if (!history.length) {
      return [new EmptyItem('No past sessions')];
    }
    return history.map((s) => this.fromSnap(s));
  }

  private fromActive(s: ActiveTerminalSession): SessionItem {
    return new SessionItem(
      s.goal.slice(0, 64) || s.id,
      'active',
      s.id,
      s.status,
      s.status,
    );
  }

  private fromSnap(s: TerminalSessionSnapshot): SessionItem {
    return new SessionItem(
      s.goal.slice(0, 64) || s.id,
      'history',
      s.id,
      new Date(s.createdAt).toLocaleString(),
      s.status || 'done',
    );
  }
}

export function registerTerminalSessionsView(
  context: vscode.ExtensionContext,
): TerminalSessionsTreeProvider {
  const provider = new TerminalSessionsTreeProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.commands.registerCommand('spockify.terminalAgent.sessions.refresh', () =>
      provider.refresh(),
    ),
    vscode.commands.registerCommand(
      'spockify.terminalAgent.openSession',
      async (id?: string | SessionItem, kind?: 'active' | 'history') => {
        const sessionId = sessionIdFromArg(id);
        const itemKind =
          id instanceof SessionItem ? id.kind : kind;
        if (!sessionId) {
          const { pickTerminalSession } = await import('./store');
          const s = await pickTerminalSession(context);
          if (s) await openSessionTranscriptDoc(s);
          return;
        }
        if (itemKind !== 'active') {
          const snap = listTerminalSessions(context).find(
            (s) => s.id === sessionId,
          );
          if (snap) {
            await openSessionTranscriptDoc(snap);
            return;
          }
        }
        const active = listActiveSessions().find((s) => s.id === sessionId);
        if (active) {
          await openActiveSessionDoc(active);
          return;
        }
        const snap = listTerminalSessions(context).find(
          (s) => s.id === sessionId,
        );
        if (snap) {
          await openSessionTranscriptDoc(snap);
        }
      },
    ),
    vscode.commands.registerCommand('spockify.terminalAgent.sessions', async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      provider.refresh();
    }),
  );
  return provider;
}
