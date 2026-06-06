/**
 * Migration journey store (EP1 MG-0) — default shape + merge-patch persistence.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { initHostExtPersistence } from '../src/host/hostExtPersistence.js';
import {
  __clearMigrationJourneys,
  getMigrationJourney,
  patchMigrationJourney,
} from '../src/host/migrationService.js';
import { MIGRATION_STAGE_KEYS } from '../src/host/migrationJourney.js';

const WF = 'workforce.finance.invoice-exception';

describe('migration journey', () => {
  beforeEach(async () => {
    initHostExtPersistence(openSqliteStorage(':memory:'));
    await __clearMigrationJourneys();
  });

  it('returns a default journey (all stages pending, nulls) when none exists', async () => {
    const j = await getMigrationJourney(WF);
    expect(j.workforceId).toBe(WF);
    expect(j.target).toBeNull();
    expect(j.dataManifest).toBeNull();
    expect(j.boundaries).toBeNull();
    for (const k of MIGRATION_STAGE_KEYS) {
      expect(j.stageStatus[k]).toBe('pending');
    }
  });

  it('merge-patches only the provided fields and persists', async () => {
    await patchMigrationJourney(WF, {
      target: { workflowId: 'sample.agents.invoice-post', targetOutcome: 'clear exceptions in <1 day' },
      stageStatus: { target: 'done' },
    });
    // a second patch touches a different field; the first must survive
    await patchMigrationJourney(WF, {
      dataManifest: { dataSources: 'ERP, invoice inbox', sensitivity: 'financial PII', approvalModel: '>$5k → human' },
      stageStatus: { 'map-data': 'done' },
    });

    const j = await getMigrationJourney(WF);
    expect(j.target?.workflowId).toBe('sample.agents.invoice-post');
    expect(j.dataManifest?.sensitivity).toBe('financial PII');
    expect(j.stageStatus.target).toBe('done');
    expect(j.stageStatus['map-data']).toBe('done');
    expect(j.stageStatus.assess).toBe('pending'); // untouched
  });

  it('supports clearing a field with null', async () => {
    await patchMigrationJourney(WF, { target: { workflowId: 'x', targetOutcome: 'y' } });
    await patchMigrationJourney(WF, { target: null });
    expect((await getMigrationJourney(WF)).target).toBeNull();
  });
});
