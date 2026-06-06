/**
 * Migration journey store (EP1 MG-0). Persists one journey per (tenant,
 * workforce) in the generic host-ext DurableCollection (no per-backend schema
 * change). TENANT-SCOPED: a journey holds tenant-authored content (the Data
 * Manifest's data sources / sensitivity), so it is keyed `${tenantId}:${workforceId}`
 * — one tenant's migration progress is never visible to another (CTI-1). The
 * Workforce ENTITY itself stays global (shared starter templates), but its
 * migration *state* is per tenant.
 */

import { DurableCollection } from './hostExtPersistence.js';
import {
  MIGRATION_STAGE_KEYS,
  type MigrationBoundaries,
  type MigrationDataManifest,
  type MigrationJourney,
  type MigrationStageKey,
  type MigrationTarget,
  type StageStatus,
} from './migrationJourney.js';

const journeys = new DurableCollection<MigrationJourney>(
  'migration',
  (j) => `${j.tenantId}:${j.workforceId}`,
);

function nowIso(): string {
  return new Date().toISOString();
}

function key(tenantId: string, workforceId: string): string {
  return `${tenantId}:${workforceId}`;
}

function emptyJourney(tenantId: string, workforceId: string): MigrationJourney {
  const stageStatus = Object.fromEntries(
    MIGRATION_STAGE_KEYS.map((k) => [k, 'pending' as StageStatus]),
  ) as Record<MigrationStageKey, StageStatus>;
  return { tenantId, workforceId, stageStatus, target: null, dataManifest: null, boundaries: null, updatedAt: nowIso() };
}

export async function getMigrationJourney(tenantId: string, workforceId: string): Promise<MigrationJourney> {
  return (await journeys.get(key(tenantId, workforceId))) ?? emptyJourney(tenantId, workforceId);
}

export interface MigrationJourneyPatch {
  target?: MigrationTarget | null;
  dataManifest?: MigrationDataManifest | null;
  boundaries?: MigrationBoundaries | null;
  stageStatus?: Partial<Record<MigrationStageKey, StageStatus>>;
}

/** Merge-patch the (tenant-scoped) journey (only provided fields change). Creates it on first patch. */
export async function patchMigrationJourney(
  tenantId: string,
  workforceId: string,
  patch: MigrationJourneyPatch,
): Promise<MigrationJourney> {
  const cur = await getMigrationJourney(tenantId, workforceId);
  const updated: MigrationJourney = {
    ...cur,
    ...(patch.target !== undefined ? { target: patch.target } : {}),
    ...(patch.dataManifest !== undefined ? { dataManifest: patch.dataManifest } : {}),
    ...(patch.boundaries !== undefined ? { boundaries: patch.boundaries } : {}),
    stageStatus: { ...cur.stageStatus, ...(patch.stageStatus ?? {}) },
    updatedAt: nowIso(),
  };
  await journeys.put(updated);
  return updated;
}

/** Test-only: drop the persisted journeys. */
export async function __clearMigrationJourneys(): Promise<void> {
  await journeys.__clear();
}
