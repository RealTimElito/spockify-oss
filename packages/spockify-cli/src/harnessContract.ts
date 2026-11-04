/**
 * Runtime names the CLI calls on the linked packages.
 * Keep in step with value imports under src/. test/harnessContract.test.ts
 * fails if a new import is missing here.
 */

export const REQUIRED_HARNESS_EXPORTS = [
  'AGENT_MAX_TURNS_HARD_CAP',
  'DEFAULT_AGENT_MAX_TURNS',
  'DEFAULT_ASK_MAX_TURNS',
  'DEFAULT_YOLO_MAX_TURNS',
  'MAX_ATTACHED_SKILLS',
  'PermissionMemory',
  'ToolRegistry',
  'codingPickerItems',
  'confirmOnce',
  'doneReason',
  'formatLabModelMissingError',
  'formatSessionPin',
  'isAutoModelId',
  'isLabCatalogId',
  'isPublicProdHost',
  'isSelectableCodingId',
  'isWriteTool',
  'loadAgentsMd',
  'loadSkills',
  'matchLabUpstreamId',
  'parseToolFences',
  'pickSkillsByName',
  'promoteLabModelHint',
  'registerCliTools',
  'registerHarnessTools',
  'resolveCliMaxTurns',
  'runAgentTurn',
  'runHarness',
  'runSwarm',
  'todosFromMessages',
  'unpublishedLabModels',
  'writeDropInSkillFromToolArgs',
] as const;

export const REQUIRED_HARNESS_HOST_EXPORTS = [
  'commandDigest',
  'ensureHarnessDir',
  'getHarness',
  'listHarnesses',
  'readActiveHarnessId',
  'resolveHarnessOrFallback',
  'runPluginHarness',
  'setActiveHarnessId',
] as const;

function missingExports(
  mod: Record<string, unknown>,
  names: readonly string[],
): string[] {
  return names.filter((name) => mod[name] === undefined);
}

/** Fail before a prompt if the installed package dists do not match this CLI. */
export function assertCliPackages(): void {
  let harness: Record<string, unknown>;
  let host: Record<string, unknown>;
  try {
    harness = require('@spockify/harness') as Record<string, unknown>;
    host = require('@spockify/harness-host') as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `CLI packages are not installed together (${detail}). Run scripts/sync-spockify-cli.sh.`,
    );
  }
  const missingHarness = missingExports(harness, REQUIRED_HARNESS_EXPORTS);
  const missingHost = missingExports(host, REQUIRED_HARNESS_HOST_EXPORTS);
  const parts: string[] = [];
  if (missingHarness.length) {
    parts.push(`@spockify/harness missing ${missingHarness.join(', ')}`);
  }
  if (missingHost.length) {
    parts.push(`@spockify/harness-host missing ${missingHost.join(', ')}`);
  }
  if (parts.length) {
    throw new Error(
      `${parts.join('; ')}. The CLI dist is newer than the harness dist. Run scripts/sync-spockify-cli.sh.`,
    );
  }
}
