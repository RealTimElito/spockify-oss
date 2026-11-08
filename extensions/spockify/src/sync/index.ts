/**
 * Sync registration — Phase 6
 * Default-on when signed in; quiet pull/push on activate.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { syncNow } from './register';

export { syncNow, buildLocalSyncPayload, getLastSyncBlob } from './register';
export type { IdeSyncPayload } from './register';

export function registerSync(
  context: vscode.ExtensionContext,
  opts: {
    getTransport: () => Promise<ModelTransport | undefined>;
    output: vscode.OutputChannel;
    refreshAuthUi?: () => Promise<void>;
  },
): void {
  const { getTransport, output } = opts;
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.sync.now', () =>
      syncNow(context, getTransport, output),
    ),
    vscode.commands.registerCommand('spockify.sync.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('spockify');
      const cur = cfg.get<boolean>('sync.enabled', true);
      await cfg.update('sync.enabled', !cur, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        `Spockify sync ${!cur ? 'enabled' : 'disabled'}`,
      );
      void opts.refreshAuthUi?.();
    }),
  );

  // Quiet startup sync when enabled + signed in (cloud continuity for Stargazer).
  void (async () => {
    const enabled = vscode.workspace
      .getConfiguration('spockify')
      .get<boolean>('sync.enabled', true);
    if (!enabled) return;
    try {
      const t = await getTransport();
      if (!t?.pullIdeSync) return;
      output.appendLine('sync: startup pull/push…');
      await syncNow(context, getTransport, output, { quiet: true });
    } catch (err) {
      output.appendLine(
        `sync: startup skipped — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();
}
