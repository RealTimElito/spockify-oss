import * as vscode from 'vscode';
import {
  ACCOUNT_API_KEY_HELP,
  DEFAULT_CLOUD_BASE,
  looksLikeRouterPort,
  normalizeProductBaseUrl,
  selfHostPlaceholder,
  signInOwui,
  type ConnectKind,
  type ConnectRequest,
} from '@spockify/ide-client';

const SECRET_KEY = 'spockify.apiKey';
const ACCOUNT_STATE = 'spockify.account';

export interface SpockifyAccount {
  /** Display label (email or "API key"). */
  label: string;
  email?: string;
  /** 'apiKey' | 'session' */
  kind: 'apiKey' | 'session';
  signedInAt: string;
}

export async function getApiKey(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const fromSecret = await context.secrets.get(SECRET_KEY);
  if (fromSecret?.trim()) {
    return fromSecret.trim();
  }
  const fromEnv = process.env.SPOCKIFY_API_KEY?.trim();
  return fromEnv || undefined;
}

export async function getAccount(
  context: vscode.ExtensionContext,
): Promise<SpockifyAccount | undefined> {
  return context.globalState.get<SpockifyAccount>(ACCOUNT_STATE);
}

/** Single read of SecretStorage + account label — shared by status bar + chat. */
export async function readAuthState(
  context: vscode.ExtensionContext,
): Promise<{
  signedIn: boolean;
  accountLabel?: string;
  key: string | undefined;
  account: SpockifyAccount | undefined;
}> {
  const key = await getApiKey(context);
  const account = await getAccount(context);
  return {
    signedIn: !!key,
    accountLabel: account?.label,
    key,
    account,
  };
}

export async function storeToken(
  context: vscode.ExtensionContext,
  token: string,
  account: SpockifyAccount,
): Promise<void> {
  await context.secrets.store(SECRET_KEY, token.trim());
  await context.globalState.update(ACCOUNT_STATE, account);
}

export async function clearAuth(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
  await context.globalState.update(ACCOUNT_STATE, undefined);
}

/** @deprecated use clearAuth */
export async function clearApiKey(
  context: vscode.ExtensionContext,
): Promise<void> {
  await clearAuth(context);
}

export async function persistBaseUrl(baseUrl: string): Promise<string> {
  const normalized = normalizeProductBaseUrl(baseUrl);
  await vscode.workspace
    .getConfiguration('spockify')
    .update('baseUrl', normalized, vscode.ConfigurationTarget.Global);
  return normalized;
}

export function currentBaseUrl(): string {
  return normalizeProductBaseUrl(
    vscode.workspace.getConfiguration('spockify').get<string>('baseUrl') ||
      DEFAULT_CLOUD_BASE,
  );
}

function requireHttpUrl(url: string): string {
  const normalized = normalizeProductBaseUrl(url);
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Base URL must start with http:// or https://');
  }
  return normalized;
}

/** Prompt to paste an sk- key (palette power-user). Prefer Settings → Account. */
export async function setApiKey(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const value = await vscode.window.showInputBox({
    title: 'Spockify API Key',
    prompt: ACCOUNT_API_KEY_HELP,
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...',
  });
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    await clearAuth(context);
    return false;
  }
  await storeToken(context, trimmed, {
    label: 'API key',
    kind: 'apiKey',
    signedInAt: new Date().toISOString(),
  });
  return true;
}

/** Email/password → OWUI JWT (cloud or self-hosted). */
export async function signInWithPassword(
  context: vscode.ExtensionContext,
  options?: { baseUrl?: string; email?: string; password?: string },
): Promise<boolean> {
  const baseUrl = requireHttpUrl(
    options?.baseUrl || currentBaseUrl() || DEFAULT_CLOUD_BASE,
  );

  const email =
    options?.email?.trim() ||
    (await vscode.window.showInputBox({
      title: 'Sign in to Spockify',
      prompt: `Email for ${baseUrl.replace(/^https?:\/\//, '')}`,
      placeHolder: 'you@example.com',
      ignoreFocusOut: true,
    }));
  if (!email?.trim()) {
    return false;
  }

  const password =
    options?.password !== undefined
      ? options.password
      : await vscode.window.showInputBox({
          title: 'Sign in to Spockify',
          prompt: `Password for ${email.trim()}`,
          password: true,
          ignoreFocusOut: true,
        });
  if (password === undefined) {
    return false;
  }

  try {
    const result = await signInOwui(baseUrl, email.trim(), password);
    await persistBaseUrl(baseUrl);
    await storeToken(context, result.token, {
      label: result.email || email.trim(),
      email: result.email || email.trim(),
      kind: 'session',
      signedInAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  }
}

export async function signInWithApiKey(
  context: vscode.ExtensionContext,
  options: { baseUrl?: string; apiKey: string },
): Promise<boolean> {
  const trimmed = options.apiKey.trim();
  if (!trimmed) {
    return false;
  }
  const baseUrl = requireHttpUrl(
    options.baseUrl || currentBaseUrl() || DEFAULT_CLOUD_BASE,
  );
  await persistBaseUrl(baseUrl);
  await storeToken(context, trimmed, {
    label: trimmed.startsWith('sk-') ? 'API key' : 'API key',
    kind: 'apiKey',
    signedInAt: new Date().toISOString(),
  });
  return true;
}

/**
 * Apply a connection form from Settings → Account (no QuickPick).
 */
export async function applyConnect(
  context: vscode.ExtensionContext,
  req: ConnectRequest,
): Promise<{ ok: boolean; baseUrl: string; warning?: string }> {
  let baseUrl =
    req.kind === 'cloud'
      ? DEFAULT_CLOUD_BASE
      : requireHttpUrl(
          req.baseUrl ||
            (req.kind === 'selfhost'
              ? selfHostPlaceholder(currentBaseUrl())
              : currentBaseUrl()),
        );
  baseUrl = await persistBaseUrl(baseUrl);

  let warning: string | undefined;
  if (looksLikeRouterPort(baseUrl)) {
    warning =
      'That looks like the router (:4100). Tab/FIM needs Open WebUI ' +
      '(:3080 compose, :30080 LAN). Chat may still work; Tab will not.';
  }

  if (req.kind === 'key' || (req.kind === 'cloud' && req.apiKey?.trim())) {
    if (!req.apiKey?.trim()) {
      throw new Error('Paste an sk- key, or use email and password.');
    }
    const ok = await signInWithApiKey(context, {
      baseUrl,
      apiKey: req.apiKey,
    });
    return { ok, baseUrl, warning };
  }

  if (!req.email?.trim() || req.password === undefined || req.password === '') {
    throw new Error('Email and password are required (or paste an sk- key).');
  }

  const ok = await signInWithPassword(context, {
    baseUrl,
    email: req.email,
    password: req.password,
  });
  return { ok, baseUrl, warning };
}

/**
 * First-class Sign in: open Settings → Account (Spockify.eu / Self-hosted / key).
 * Not GitHub Copilot. Not a QuickPick wizard.
 */
export async function signIn(
  _context?: vscode.ExtensionContext,
): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('spockify.settings.open', 'account');
  } catch {
    void vscode.window.showInformationMessage(
      'Open Spockify Settings → Account to connect (Spockify.eu, self-hosted, or API key).',
    );
  }
  return false;
}

/** @deprecated QuickPick path — Settings → Account is the UI. */
export async function signInSelfHosted(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  await persistBaseUrl(selfHostPlaceholder(currentBaseUrl()));
  return signIn(context);
}

export function connectKindFromBaseUrl(baseUrl?: string): ConnectKind {
  const raw = (baseUrl || currentBaseUrl()).trim();
  if (!raw || /spockify\.eu/i.test(raw)) return 'cloud';
  return 'selfhost';
}

export class AuthStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = 'spockify.signIn';
    this.item.tooltip = 'Spockify connection';
  }

  get disposable(): vscode.Disposable {
    return this.item;
  }

  async refresh(
    preloaded?: {
      key: string | undefined;
      account: SpockifyAccount | undefined;
    },
  ): Promise<void> {
    const key = preloaded ? preloaded.key : await getApiKey(this.context);
    const account = preloaded
      ? preloaded.account
      : await getAccount(this.context);
    const host = currentBaseUrl()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    if (!key) {
      this.item.text = '$(plug) Spockify';
      this.item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
      this.item.command = 'spockify.signIn';
      this.item.tooltip =
        'Connect Spockify.eu or your self-hosted stack (Settings → Account)';
    } else {
      const label = account?.label || 'signed in';
      this.item.text = `$(check) ${host}`;
      this.item.backgroundColor = undefined;
      this.item.command = 'spockify.accountMenu';
      this.item.tooltip = `${label} @ ${host}\nProduct root (IDE appends /v1). Click for Settings → Account.`;
    }
    this.item.show();
  }
}
