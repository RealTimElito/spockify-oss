import * as vscode from 'vscode';
import { signInOwui } from '@spockify/ide-client';

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

/** Prompt to paste a LiteLLM virtual key. */
export async function setApiKey(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const value = await vscode.window.showInputBox({
    title: 'Spockify API Key',
    prompt:
      'Paste a LiteLLM virtual key (Bearer). Create at https://spockify.eu/ui/',
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

/** Email/password → OWUI JWT (spockify.eu account). */
export async function signInWithPassword(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const baseUrl =
    vscode.workspace.getConfiguration('spockify').get<string>('baseUrl') ||
    'https://spockify.eu';

  const email = await vscode.window.showInputBox({
    title: 'Sign in to Spockify',
    prompt: 'Email for your spockify.eu account',
    placeHolder: 'you@example.com',
    ignoreFocusOut: true,
  });
  if (!email?.trim()) {
    return false;
  }

  const password = await vscode.window.showInputBox({
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
    await storeToken(context, result.token, {
      label: result.email || email.trim(),
      email: result.email || email.trim(),
      kind: 'session',
      signedInAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Spockify sign-in failed: ${msg}`);
    return false;
  }
}

/**
 * First-class Sign in: pick API key or account password.
 * No GitHub Copilot / Microsoft login.
 */
export async function signIn(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: '$(account) Email & password',
        description: 'Same account as spockify.eu web chat (recommended for Tab)',
        id: 'password' as const,
      },
      {
        label: '$(key) API key',
        description: 'LiteLLM virtual key from spockify.eu/ui/',
        id: 'key' as const,
      },
      {
        label: '$(link-external) Open spockify.eu/ui/',
        description: 'Create LiteLLM virtual keys for API-key sign-in',
        id: 'open' as const,
      },
    ],
    {
      title: 'Sign in to Spockify',
      placeHolder: 'Choose how to authenticate (not GitHub Copilot)',
      ignoreFocusOut: true,
    },
  );
  if (!pick) {
    return false;
  }
  if (pick.id === 'open') {
    await vscode.env.openExternal(
      vscode.Uri.parse('https://spockify.eu/ui/'),
    );
    return false;
  }
  if (pick.id === 'password') {
    return signInWithPassword(context);
  }
  return setApiKey(context);
}

export class AuthStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = 'spockify.signIn';
    this.item.tooltip = 'Spockify account (spockify.eu)';
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
    const base =
      vscode.workspace.getConfiguration('spockify').get<string>('baseUrl') ||
      'https://spockify.eu';
    const host = base.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    if (!key) {
      this.item.text = '$(account) Spockify: Sign in';
      this.item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
      this.item.command = 'spockify.signIn';
      this.item.tooltip = 'Spockify account (spockify.eu)';
    } else {
      const label = account?.label || 'signed in';
      this.item.text = `$(check) Spockify: ${label}`;
      this.item.backgroundColor = undefined;
      this.item.command = 'spockify.accountMenu';
      this.item.tooltip = `${label} @ ${host}`;
    }
    this.item.show();
  }
}
