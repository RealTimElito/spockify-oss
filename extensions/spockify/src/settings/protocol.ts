/**
 * Extension ↔ webview protocol for Spockify Settings (Cursor-like page).
 */

export type SettingsSectionId =
  | 'account'
  | 'general'
  | 'usage'
  | 'models'
  | 'rules'
  | 'indexing'
  | 'agent'
  | 'updates';

export interface SettingsAccountSnapshot {
  signedIn: boolean;
  label?: string;
  kind?: 'apiKey' | 'session';
  /** Masked credential hint — never full secret. */
  keyHint: string;
  signedInAt?: string;
  host: string;
}

export interface SettingsConnectionHelp {
  cloudBase: string;
  selfHostPlaceholder: string;
  selfHostLanHint: string;
  accountApiKeyHelp: string;
  tabFimHelp: string;
}

export interface SettingsUsageSnapshot {
  available: boolean;
  message: string;
  spend?: number;
  requests?: number;
  totalTokens?: number;
  daily?: Array<{ day: string; spend: number; requests: number }>;
  byModel?: Array<{ model: string; spend: number; requests: number }>;
}

export interface SettingsModelRow {
  id: string;
  label?: string;
}

export interface SettingsRulesSnapshot {
  layers: Array<{ layer: string; source: string; chars: number }>;
  memoriesCount: number;
  projectRulesPath?: string;
  globalRulesPath: string;
  userRulesPath: string;
  skillsNote: string;
}

export interface SettingsIndexSnapshot {
  status: string;
  chunks?: number;
  files?: number;
  embedModel?: string;
  error?: string;
  indexOnStartup: boolean;
  autoAttach: boolean;
  autoAttachAsk: boolean;
  hybrid: boolean;
  reindexOnSave: boolean;
  remoteIndexMeta: boolean;
}

export interface SettingsSnapshot {
  section?: SettingsSectionId;
  version: string;
  baseUrl: string;
  provider: string;
  defaultModel: string;
  ossOnly: boolean;
  codingOnly: boolean;
  agentMode: string;
  runAllUnsandboxed: boolean;
  agentPermissionMode: string;
  chatMaxMode: boolean;
  chatThinking: string;
  chatOrchestratorModel: string;
  chatAttachTerminal: boolean;
  completionsEnabled: boolean;
  completionsModel: string;
  terminalPolicy: string;
  terminalAllowlistTier: string;
  terminalPlanApproval: boolean;
  syncEnabled: boolean;
  updateCheckOnStartup: boolean;
  account: SettingsAccountSnapshot;
  connection: SettingsConnectionHelp;
  usage: SettingsUsageSnapshot;
  models: SettingsModelRow[];
  rules: SettingsRulesSnapshot;
  indexing: SettingsIndexSnapshot;
  releasesUrl: string;
  siteUrl: string;
}

export type HostToSettings =
  | { type: 'snapshot'; data: SettingsSnapshot }
  | { type: 'usage'; data: SettingsUsageSnapshot }
  | { type: 'toast'; message: string; level?: 'info' | 'warn' | 'error' };

export type SettingsToHost =
  | { type: 'ready'; section?: SettingsSectionId }
  | { type: 'refresh' }
  | {
      type: 'setConfig';
      /** Dotted key under spockify, e.g. `defaultModel` or `codebase.hybrid`. */
      key: string;
      value: string | boolean | number;
    }
  | { type: 'runCommand'; command: string }
  | { type: 'openExternal'; url: string }
  | { type: 'openPath'; kind: 'projectRules' | 'userRules' | 'globalRules' | 'skillsDir' }
  | { type: 'signIn' }
  | {
      type: 'connect';
      kind: 'selfhost' | 'key';
      baseUrl?: string;
      email?: string;
      password?: string;
      apiKey?: string;
    }
  | { type: 'signOut' }
  | { type: 'fetchUsage' }
  | { type: 'openStockSettings'; query?: string };
