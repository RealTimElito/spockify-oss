/**
 * Deep links from IDE → spockify.eu web features (no rebuild in desktop).
 */

import * as vscode from 'vscode';

const BASE = 'https://spockify.eu';

/** Public product URLs — keep paths stable; do not expose infra hostnames. */
export const SPOCKIFY_WEB_LINKS = {
  home: `${BASE}/`,
  /** Vault lock lives on web chat threads. */
  vault: `${BASE}/`,
  scheduledAgents: `${BASE}/spockify/agents`,
  familyGuest: `${BASE}/admin/settings/spockify-family`,
  ide: `${BASE}/ide`,
  help: `${BASE}/ide/help.html`,
  hub: `${BASE}/spockify`,
} as const;

async function openSpockifyUrl(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

export function registerWebBridgeCommands(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.web.openVault', () =>
      openSpockifyUrl(SPOCKIFY_WEB_LINKS.vault),
    ),
    vscode.commands.registerCommand('spockify.web.openScheduledAgents', () =>
      openSpockifyUrl(SPOCKIFY_WEB_LINKS.scheduledAgents),
    ),
    vscode.commands.registerCommand('spockify.web.openFamilySettings', () =>
      openSpockifyUrl(SPOCKIFY_WEB_LINKS.familyGuest),
    ),
    vscode.commands.registerCommand('spockify.web.openIdeSite', () =>
      openSpockifyUrl(SPOCKIFY_WEB_LINKS.ide),
    ),
  );
}
