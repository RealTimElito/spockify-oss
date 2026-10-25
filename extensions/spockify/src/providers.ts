/**
 * Provider helpers for the extension host.
 * Prefer `@spockify/ide-client` `createModelTransport` — this module documents
 * the settings ↔ provider mapping for WS-C / WS-D.
 */
import type { ProviderId } from '@spockify/ide-client';

export interface ProviderSetting {
  id: ProviderId;
  label: string;
  /** When false, Settings UI should treat as coming soon. */
  enabled: boolean;
}

export const PROVIDERS: ProviderSetting[] = [
  {
    id: 'remote',
    label: 'Spockify cloud (spockify.eu)',
    enabled: true,
  },
  {
    id: 'local',
    label: 'Local models (coming soon)',
    enabled: false,
  },
];

export function isProviderEnabled(id: ProviderId): boolean {
  return PROVIDERS.find((p) => p.id === id)?.enabled ?? false;
}
