/**
 * Read IDE coding-picker options from `spockify.models.*` settings.
 */

import * as vscode from 'vscode';

import type { MergePickerOptions } from './modelCatalog';

/** Options for chat / composer / agent model pickers. */
export function codingPickerOptionsFromConfig(
  cfg?: vscode.WorkspaceConfiguration,
): MergePickerOptions {
  const c = cfg ?? vscode.workspace.getConfiguration('spockify');
  const codingOnly = c.get<boolean>('models.codingOnly', true);
  const allowPrefixes = c.get<string[]>('models.codingAllowPrefixes');
  return {
    codingOnly,
    allowPrefixes: Array.isArray(allowPrefixes) ? allowPrefixes : undefined,
  };
}
