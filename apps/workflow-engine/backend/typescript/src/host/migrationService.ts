/**
 * Migration journey store (EP1 MG-0). Persists one journey per workforce in the
 * generic host-ext DurableCollection (no per-backend schema change). Keyed by
 * workforceId, consistent with the Workforce entity's global scoping (demo
 * simplification — a production host would scope per tenant).
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

const journeys = new DurableCollection<MigrationJourney>('migration', (j) => j.workforceId);

function nowIso(): string {
  return new Date().toISOString();
}

function emptyJourney(workforceId: string): MigrationJourney {
  const stageStatus = Object.fromEntries(
    MIGRATION_STAGE_KEYS.map((k) => [k, 'pending' as StageStatus]),
  ) as Record<MigrationStageKey, StageStatus>;
  return { workforceId, stageStatus, target: null, dataManifest: null, boundaries: null, updatedAt: nowIso() };
}

export async function getMigrationJourney(workforceId: string): Promise<MigrationJourney> {
  return (await journeys.get(workforceId)) ?? emptyJourney(workforceId);
}

export interface MigrationJourneyPatch {
  target?: MigrationTarget | null;
  dataManifest?: MigrationDataManifest | null;
  boundaries?: MigrationBoundaries | null;
  stageStatus?: Partial<Record<MigrationStageKey, StageStatus>>;
}

/** Merge-patch the journey (only provided fields change). Creates it on first patch. */
export async function patchMigrationJourney(
  workforceId: string,
  patch: MigrationJourneyPatch,
): Promise<MigrationJourney> {
  const cur = await getMigrationJourney(workforceId);
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
