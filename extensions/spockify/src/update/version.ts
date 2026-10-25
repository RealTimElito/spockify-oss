/**
 * Pure Spockify IDE version helpers for AppImage update checks.
 * Kept free of `vscode` so unit tests can import without the extension host.
 */

export type UpdateCandidate = {
  version: string;
  downloadUrl: string;
  releaseNotesUrl: string;
  sha256?: string;
};

/** Fallback when feed omits releaseNotesUrl (older OWUI). */
export const DEFAULT_RELEASES_URL = 'https://spockify.eu/ide/releases.html';

export function parseSemverish(v: string): [number, number, number] {
  const m = String(v)
    .trim()
    .replace(/^v/i, '')
    .match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when remote is strictly newer than local on the Spockify IDE version axis. */
export function isNewer(remoteVersion: string, localVersion: string): boolean {
  const a = parseSemverish(remoteVersion);
  const b = parseSemverish(localVersion);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * Pick the highest semver-ish among candidates (ignores empty / unparsable).
 */
export function pickHighestVersion(
  ...candidates: Array<string | undefined>
): string {
  let best = '0.0.0';
  let bestParts = parseSemverish(best);
  for (const c of candidates) {
    if (!c || !String(c).trim()) continue;
    const s = String(c).trim();
    const parts = parseSemverish(s);
    // Skip garbage that parses as 0.0.0 unless the string is literally 0.0.0
    if (parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && s !== '0.0.0') {
      continue;
    }
    for (let i = 0; i < 3; i++) {
      if (parts[i] > bestParts[i]) {
        best = s;
        bestParts = parts;
        break;
      }
      if (parts[i] < bestParts[i]) {
        break;
      }
    }
  }
  return best;
}

function pickSpockifyFeedVersion(
  body: Record<string, unknown>,
): string | undefined {
  const productVersion =
    typeof body.productVersion === 'string' ? body.productVersion.trim() : '';

  const appImage =
    body.appImage && typeof body.appImage === 'object'
      ? (body.appImage as Record<string, unknown>)
      : undefined;
  const latest =
    body.latest && typeof body.latest === 'object'
      ? (body.latest as Record<string, unknown>)
      : undefined;
  const release =
    body.release && typeof body.release === 'object'
      ? (body.release as Record<string, unknown>)
      : undefined;

  const preferred = [
    body.spockifyIdeVersion,
    body.appImageVersion,
    appImage?.spockifyIdeVersion,
    appImage?.appImageVersion,
  ];
  for (const v of preferred) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  // Ambiguous legacy keys — reject if they look like code-oss productVersion.
  const ambiguous = [
    body.version,
    appImage?.version,
    latest?.version,
    release?.version,
  ];
  for (const v of ambiguous) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const trimmed = v.trim();
    if (productVersion && trimmed === productVersion) continue;
    return trimmed;
  }
  return undefined;
}

export function extractCandidate(
  body: unknown,
  arch: string,
): UpdateCandidate | undefined {
  const b = (body ?? {}) as Record<string, unknown>;

  // spockifyIdeVersion / appImageVersion = extension package version (update axis).
  // Plain `version` is accepted for older feeds unless it equals productVersion.
  const version = pickSpockifyFeedVersion(b);

  const appImage =
    b.appImage && typeof b.appImage === 'object'
      ? (b.appImage as Record<string, unknown>)
      : undefined;
  const latest =
    b.latest && typeof b.latest === 'object'
      ? (b.latest as Record<string, unknown>)
      : undefined;
  const release =
    b.release && typeof b.release === 'object'
      ? (b.release as Record<string, unknown>)
      : undefined;

  const downloadUrl =
    (typeof b.downloadUrl === 'string' && b.downloadUrl) ||
    (typeof appImage?.downloadUrl === 'string' && appImage.downloadUrl) ||
    (typeof appImage?.url === 'string' && appImage.url) ||
    (typeof latest?.downloadUrl === 'string' && latest.downloadUrl) ||
    (typeof release?.downloadUrl === 'string' && release.downloadUrl) ||
    undefined;

  const releaseNotesUrl =
    (typeof b.releaseNotesUrl === 'string' && b.releaseNotesUrl) ||
    (typeof release?.notesUrl === 'string' && release.notesUrl) ||
    (typeof latest?.releaseNotesUrl === 'string' && latest.releaseNotesUrl) ||
    (typeof b.notesUrl === 'string' && b.notesUrl) ||
    DEFAULT_RELEASES_URL;

  const sha256 =
    (typeof b.sha256 === 'string' && b.sha256) ||
    (typeof appImage?.sha256 === 'string' && appImage.sha256) ||
    (typeof latest?.sha256 === 'string' && latest.sha256) ||
    (typeof release?.sha256 === 'string' && release.sha256) ||
    undefined;

  if (!downloadUrl && b.assets && typeof b.assets === 'object') {
    const assets = b.assets as Record<string, Record<string, unknown>>;
    const asset = assets[arch] ?? assets[`linux-${arch}`];
    const assetUrl =
      (typeof asset?.downloadUrl === 'string' && asset.downloadUrl) ||
      (typeof asset?.url === 'string' && asset.url) ||
      (typeof asset?.browser_download_url === 'string' &&
        asset.browser_download_url) ||
      undefined;
    const assetSha =
      (typeof asset?.sha256 === 'string' && asset.sha256) ||
      (typeof asset?.digest === 'string' && asset.digest) ||
      undefined;
    if (assetUrl && version) {
      return {
        version,
        downloadUrl: assetUrl,
        releaseNotesUrl,
        sha256: assetSha,
      };
    }
  }

  if (version && downloadUrl) {
    return { version, downloadUrl, releaseNotesUrl, sha256 };
  }
  return undefined;
}
