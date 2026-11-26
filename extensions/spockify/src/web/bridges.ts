/**
 * Deep links from IDE → the user's configured Spockify chat UI
 * (product root from settings — never a hard-coded hosted cloud).
 */

import * as vscode from 'vscode';
import { DEFAULT_SELF_HOST_BASE, normalizeProductBaseUrl } from '@spockify/ide-client';

function productRoot(): string {
  const cfg = vscode.workspace.getConfiguration('spockify');
  return normalizeProductBaseUrl(
    cfg.get<string>('baseUrl') || DEFAULT_SELF_HOST_BASE,
  );
}

/** Paths relative to the product root. */
export function spockifyWebLinks(root = productRoot()) {
  const base = root.replace(/\/+$/, '');
  return {
    home: `${base}/`,
    vault: `${base}/`,
    scheduledAgents: `${base}/spockify/agents`,
    familyGuest: `${base}/admin/settings/spockify-family`,
    ide: `${base}/ide`,
    help: 'https://github.com/Spockify/spockify-oss#get-started',
    hub: `${base}/spockify`,
    docs: 'https://github.com/Spockify/spockify-oss',
  } as const;
}

/** @deprecated Prefer spockifyWebLinks() so URLs follow the configured base. */
export const SPOCKIFY_WEB_LINKS = spockifyWebLinks(DEFAULT_SELF_HOST_BASE);

async function openSpockifyUrl(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

export function registerWebBridgeCommands(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.web.openVault', () =>
      openSpockifyUrl(spockifyWebLinks().vault),
    ),
    vscode.commands.registerCommand('spockify.web.openScheduledAgents', () =>
      openSpockifyUrl(spockifyWebLinks().scheduledAgents),
    ),
    vscode.commands.registerCommand('spockify.web.openFamilySettings', () =>
      openSpockifyUrl(spockifyWebLinks().familyGuest),
    ),
    vscode.commands.registerCommand('spockify.web.openIdeSite', () =>
      openSpockifyUrl(spockifyWebLinks().docs),
    ),
  );
}
