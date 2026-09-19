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

/** Lab twin dual-role ids from settings (benign orch/exec aliases). */
export function labDualRoleFromConfig(cfg?: vscode.WorkspaceConfiguration): {
  orch: string;
  exec: string;
} {
  const c = cfg ?? vscode.workspace.getConfiguration('spockify');
  return {
    orch: c.get<string>('lab.orchestratorModel') || 'lab-orchestrator',
    exec: c.get<string>('lab.executorModel') || 'lab-executor',
  };
}

/**
 * Prefer lab executor when pointing at a non-cloud HTTP stack and default is Auto.
 */
export function resolveCodingDefaultModel(
  cfg?: vscode.WorkspaceConfiguration,
): string {
  const c = cfg ?? vscode.workspace.getConfiguration('spockify');
  const configured = (c.get<string>('defaultModel') || 'spockify-auto').trim();
  const baseUrl = (c.get<string>('baseUrl') || '').trim().toLowerCase();
  const onCloud =
    !baseUrl ||
    baseUrl.includes('spockify.eu') ||
    baseUrl.startsWith('https://');
  if (configured !== 'spockify-auto' || onCloud) {
    return configured || 'spockify-auto';
  }
  if (baseUrl.startsWith('http://')) {
    return labDualRoleFromConfig(c).exec;
  }
  return configured;
}
