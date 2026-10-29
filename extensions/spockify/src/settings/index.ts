/**
 * Register Spockify Settings command + status bar gear.
 */

import * as vscode from 'vscode';
import { openSettingsPanel, refreshOpenSettingsPanel, type SettingsPanelDeps } from './SettingsPanel';
import type { SettingsSectionId } from './protocol';

export const SETTINGS_COMMAND = 'spockify.settings.open';

export function registerSettings(deps: SettingsPanelDeps): void {
  const { context } = deps;

  const gear = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    101,
  );
  gear.text = '$(gear)';
  gear.tooltip = 'Spockify Settings';
  gear.command = SETTINGS_COMMAND;
  gear.show();
  context.subscriptions.push(gear);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      SETTINGS_COMMAND,
      async (section?: SettingsSectionId) => {
        await openSettingsPanel(deps, section);
      },
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('spockify')) {
        void refreshOpenSettingsPanel();
      }
    }),
  );
}

export type { SettingsSectionId } from './protocol';
