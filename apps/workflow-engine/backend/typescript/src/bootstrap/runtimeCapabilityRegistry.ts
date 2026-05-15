/**
 * Runtime capability registry — the set of host-provided capabilities
 * NodeModules can declare in their `requires` list.
 *
 * The sample advertises a small set of capabilities backed by host
 * adapters: `secrets`, `audit`, `observability`, `artifacts.local`.
 * Anything else → executor refuses dispatch with `host_capability_missing`.
 */

import { setRuntimeCapabilities } from '../executor/runtimeCapabilities.js';

const SAMPLE_CAPABILITIES = [
  'secrets',
  'audit',
  'observability',
  'artifacts.local',
];

export function ensureRuntimeCapabilityRegistryInstalled(): void {
  setRuntimeCapabilities(SAMPLE_CAPABILITIES);
}
