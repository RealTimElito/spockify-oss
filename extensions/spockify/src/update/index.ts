/**
 * Phase 7 auto-update — check Spockify cloud metadata for a newer AppImage.
 *
 * Why this exists:
 * - VS Code's built-in electron updater hits `${updateUrl}/api/update/...`.
 *   Spockify removes `updateUrl` from product.json (and sets `update.mode=none`) so
 *   LinuxUpdateService never polls; AppImage updates are handled here instead.
 *
 * Version rule (MUST stay consistent with backend latest.json):
 * - Compare **spockifyIdeVersion** only — the Spockify extension `package.json` `version`
 *   (e.g. `0.6.3`). Do NOT compare code-oss / product version (`1.129.x`); that is
 *   packaging metadata only (`productVersion` in the feed).
 * - Remote field preference: `spockifyIdeVersion` → `appImageVersion` → `version`
 *   (but never a bare `version` that equals `productVersion`).
 * - Local value: prefer bundled `appRoot/extensions/spockify/package.json` and
 *   `product.json` `spockifyIdeVersion` (the running AppImage/deb tree). Fall back
 *   to `context.extension.packageJSON.version` / registry.
 * - When shipping a new AppImage: bump extension version, rebuild, then set the feed
 *   `spockifyIdeVersion` / `version` to the same string (and stamp product overlay).
 * - Equal versions ⇒ no “update available” prompt (manual check says up to date).
 *
 * UX:
 * - Startup: if a newer AppImage exists, show an information prompt + status bar banner.
 * - Primary CTA (Download / status bar): open releases page so the user can pick
 *   AppImage or .deb (`releaseNotesUrl`, else DEFAULT_RELEASES_URL).
 * - Secondary: Direct download opens raw AppImage `downloadUrl`.
 * - After that: check hourly; update the banner when a newer version appears.
 *
 * Network:
 * - Scheduled checks suppress most error logging to avoid log spam.
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  DEFAULT_RELEASES_URL,
  extractCandidate,
  isNewer,
  parseSemverish,
  pickHighestVersion,
  type UpdateCandidate,
} from './version';

export {
  extractCandidate,
  isNewer,
  parseSemverish,
  pickHighestVersion,
} from './version';
export type { UpdateCandidate } from './version';

const DEFAULT_METADATA_URL_TEMPLATE =
  // Placeholder supports per-arch metadata if backend supports it.
  'https://spockify.eu/api/v1/spockify/ide/appimage/latest.json?arch={arch}';

const EXTENSION_ID = 'spockify.spockify';

export function detectArch(): string {
  // VS Code extension host runs on the same machine arch as the Electron app.
  // Electron arch values: x64 | arm64
  const arch = process.arch;
  if (arch === 'x64') return 'x86_64';
  if (arch === 'arm64') return 'aarch64';
  return arch;
}

function readJsonVersion(filePath: string, keys: string[]): string | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const body = JSON.parse(raw) as Record<string, unknown>;
    for (const key of keys) {
      const v = body[key];
      if (typeof v === 'string' && v.trim()) {
        return v.trim();
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Installed Spockify IDE version (= extension / packaging axis).
 *
 * Prefer the version stamped into the running app tree (AppImage/deb under
 * `vscode.env.appRoot`) over `context.extension.packageJSON`, which can lag when
 * a stale user-data extension or old extract is still what the host activated.
 */
export function resolveLocalVersion(
  context: Pick<vscode.ExtensionContext, 'extension'>,
): string {
  const appRoot = vscode.env.appRoot || '';
  const fromBundledPkg = appRoot
    ? readJsonVersion(
        path.join(appRoot, 'extensions', 'spockify', 'package.json'),
        ['version'],
      )
    : undefined;
  const fromProduct = appRoot
    ? readJsonVersion(path.join(appRoot, 'product.json'), [
        'spockifyIdeVersion',
        'appImageVersion',
      ])
    : undefined;
  const fromContext = context.extension?.packageJSON?.version as
    | string
    | undefined;
  const fromRegistry = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON
    ?.version as string | undefined;

  // appRoot sources win when present; otherwise extension host metadata.
  if (fromBundledPkg || fromProduct) {
    return pickHighestVersion(fromBundledPkg, fromProduct) || '0.0.0';
  }
  return pickHighestVersion(fromContext, fromRegistry) || '0.0.0';
}

function computeNextHourDelay(nowMs: number): number {
  const now = new Date(nowMs);
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

export function registerUpdateCheck(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  const cfg = vscode.workspace.getConfiguration('spockify');

  const metadataUrlTemplate =
    cfg.get<string>('update.metadataUrl') ?? DEFAULT_METADATA_URL_TEMPLATE;
  const checkIntervalHours =
    cfg.get<number>('update.checkIntervalHours', 1) ?? 1;
  const downloadToCache = cfg.get<boolean>('update.downloadToCache', false);

  let statusItem: vscode.StatusBarItem | undefined;
  let cachedCandidate: UpdateCandidate | undefined;

  let inFlight = false;
  let intervalTimer: NodeJS.Timeout | undefined;
  let initialTimer: NodeJS.Timeout | undefined;

  const shouldLogErrors = (source: 'manual' | 'startup' | 'scheduled') =>
    source === 'manual';

  const shouldLogErrorOncePerDay = async (
    source: 'manual' | 'startup' | 'scheduled',
  ): Promise<boolean> => {
    if (source === 'manual') return true;
    const lastLoggedAt = context.globalState.get<number>(
      'spockify.update.lastErrorLoggedAt',
      0,
    );
    const now = Date.now();
    if (now - lastLoggedAt > 24 * 60 * 60 * 1000) {
      void context.globalState.update('spockify.update.lastErrorLoggedAt', now);
      return true;
    }
    return false;
  };

  const ensureStatusBanner = (candidate: UpdateCandidate): void => {
    cachedCandidate = candidate;
    if (!statusItem) {
      statusItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100,
      );
      statusItem.command = 'spockify.update.openDownload';
    }

    statusItem.text = `$(download) Spockify update ${candidate.version}`;
    statusItem.tooltip = `Spockify IDE update available (${candidate.version}). Click to open the releases page.`;
    statusItem.show();
  };

  const hideStatusBanner = (): void => {
    statusItem?.hide();
  };

  const openReleasesPage = async (url?: string): Promise<void> => {
    const target =
      url ||
      cachedCandidate?.releaseNotesUrl ||
      DEFAULT_RELEASES_URL;
    await vscode.env.openExternal(vscode.Uri.parse(target));
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'spockify.update.openDownload',
      async () => {
        await openReleasesPage();
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'spockify.update.openDirectDownload',
      async () => {
        if (!cachedCandidate?.downloadUrl) return;

        if (!downloadToCache) {
          await vscode.env.openExternal(
            vscode.Uri.parse(cachedCandidate.downloadUrl),
          );
          return;
        }

        const cacheDir = path.join(context.globalStoragePath, 'appimage-cache');
        await fsPromises.mkdir(cacheDir, { recursive: true });

        const filename =
          path.basename(new URL(cachedCandidate.downloadUrl).pathname) ||
          `Spockify-IDE-${cachedCandidate.version}.AppImage`;

        const destPath = path.join(cacheDir, filename);
        const res = await fetch(cachedCandidate.downloadUrl, {
          headers: { Accept: 'application/octet-stream' },
        });
        if (!res.ok) {
          throw new Error(`Download failed: HTTP ${res.status}`);
        }

        const bytes = Buffer.from(await res.arrayBuffer());
        await fsPromises.writeFile(destPath, bytes);

        await vscode.env.openExternal(vscode.Uri.file(destPath));
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'spockify.update.openReleaseNotes',
      async (url?: string) => {
        await openReleasesPage(url);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.update.check', () => {
      void checkAndNotify('manual');
    }),
  );

  const checkAndNotify = async (
    source: 'manual' | 'startup' | 'scheduled',
  ): Promise<void> => {
    if (inFlight) return;
    inFlight = true;

    try {
      const enabledOnStartup = cfg.get<boolean>('update.checkOnStartup', true);
      if (source === 'startup' && !enabledOnStartup) return;
      if (
        source === 'scheduled' &&
        !cfg.get<boolean>('update.checkOnStartup', true)
      )
        return;

      const arch = detectArch();
      const localVersion = resolveLocalVersion(context);

      const metadataUrl = metadataUrlTemplate.replace('{arch}', arch);

      const timeoutMs = cfg.get<number>('update.requestTimeoutMs', 8000);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(metadataUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }).finally(() => clearTimeout(t));

      if (!res.ok) {
        throw new Error(
          `Update metadata fetch failed: HTTP ${res.status} (${metadataUrl})`,
        );
      }

      const body = await res.json();
      const candidate = extractCandidate(body, arch);

      if (!candidate) {
        if (source === 'manual') {
          void vscode.window.showInformationMessage(
            'Spockify update check: no release metadata found.',
          );
        }
        return;
      }

      if (!isNewer(candidate.version, localVersion)) {
        hideStatusBanner();
        cachedCandidate = candidate;
        if (source === 'manual') {
          void vscode.window.showInformationMessage(
            `Spockify IDE is up to date (${localVersion}).`,
          );
        }
        return;
      }

      const alreadyDismissedVersion = context.globalState.get<string>(
        'spockify.update.dismissedVersion',
        '',
      );
      if (alreadyDismissedVersion === candidate.version) {
        cachedCandidate = candidate;
        return;
      }

      ensureStatusBanner(candidate);

      if (source !== 'manual' && source !== 'startup') {
        return;
      }

      const pick = await vscode.window.showInformationMessage(
        `Spockify update available: ${candidate.version} (installed ${localVersion})`,
        'Download',
        'Release notes',
        'Direct download',
        'Dismiss',
      );

      if (pick === 'Download') {
        await vscode.commands.executeCommand('spockify.update.openDownload');
      } else if (pick === 'Release notes') {
        await vscode.commands.executeCommand(
          'spockify.update.openReleaseNotes',
          candidate.releaseNotesUrl,
        );
      } else if (pick === 'Direct download') {
        await vscode.commands.executeCommand(
          'spockify.update.openDirectDownload',
        );
      } else if (pick === 'Dismiss') {
        void context.globalState.update(
          'spockify.update.dismissedVersion',
          candidate.version,
        );
        hideStatusBanner();
      }
    } catch (err) {
      const doLog = await shouldLogErrorOncePerDay(source);
      if (doLog) {
        const msg = err instanceof Error ? err.message : String(err);
        if (shouldLogErrors(source)) {
          output.appendLine(`update: ${msg}`);
        } else {
          output.appendLine(`update: (suppressed errors) ${msg}`);
        }
      }
      if (source === 'manual') {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `Spockify update check failed: ${msg}`,
        );
      }
    } finally {
      inFlight = false;
    }
  };

  void checkAndNotify('startup');

  const intervalHoursEnabled =
    cfg.get<number>('update.checkIntervalHours', 1) > 0;
  if (intervalHoursEnabled) {
    const delayMs = computeNextHourDelay(Date.now());
    initialTimer = setTimeout(() => {
      intervalTimer = setInterval(() => {
        void checkAndNotify('scheduled');
      }, Math.max(1, checkIntervalHours) * 60 * 60 * 1000);
    }, delayMs);

    context.subscriptions.push({
      dispose: () => {
        if (initialTimer) clearTimeout(initialTimer);
        if (intervalTimer) clearInterval(intervalTimer);
      },
    });
  }
}
