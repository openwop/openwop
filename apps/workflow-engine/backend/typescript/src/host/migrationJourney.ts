/**
 * Workflow Migration journey (EP1 MG-0) — the guided, stateful flow that walks
 * a company through rebuilding one workflow as a governed Workforce.
 *
 * Six stages: Target → Assess → Map Data → Map Boundaries → Shadow & Prove →
 * Cut Over. Persisted per workforce (host-extension; not a wire/spec type).
 * Vendor-neutral.
 */

export type MigrationStageKey =
  | 'target'
  | 'assess'
  | 'map-data'
  | 'map-boundaries'
  | 'shadow-prove'
  | 'cut-over';

export type StageStatus = 'pending' | 'done';

export interface MigrationTarget {
  workflowId: string;
  targetOutcome: string;
}

export interface MigrationDataManifest {
  dataSources: string;
  sensitivity: string;
  approvalModel: string;
}

export interface MigrationBoundaries {
  auto: string[];
  review: string[];
}

export interface MigrationJourney {
  /** Owning tenant — the journey is scoped per (tenant, workforce) (CTI-1). */
  tenantId: string;
  workforceId: string;
  stageStatus: Record<MigrationStageKey, StageStatus>;
  target: MigrationTarget | null;
  dataManifest: MigrationDataManifest | null;
  boundaries: MigrationBoundaries | null;
  updatedAt: string;
}

/** Static stage catalog — title + whether the stage is gated on a spec RFC
 *  (Shadow & Prove needs the shadow-run contract; surfaced as not-yet-available
 *  rather than faked). Order is the journey order. */
export const MIGRATION_STAGES: readonly {
  key: MigrationStageKey;
  title: string;
  blurb: string;
  rfcGated?: boolean;
}[] = [
  { key: 'target', title: 'Target', blurb: 'Define the future-state workflow and the outcome it must deliver.' },
  { key: 'assess', title: 'Assess', blurb: 'Check the host advertises the capabilities this workflow needs.' },
  { key: 'map-data', title: 'Map Data', blurb: 'Declare data sources, sensitivity, and the approval model.' },
  { key: 'map-boundaries', title: 'Map Boundaries', blurb: 'Mark which steps are auto-safe vs human-review.' },
  { key: 'shadow-prove', title: 'Shadow & Prove', blurb: 'Run alongside the legacy process and compare outputs.', rfcGated: true },
  { key: 'cut-over', title: 'Cut Over', blurb: 'Move production responsibility once the agent has graduated.' },
];

export const MIGRATION_STAGE_KEYS: readonly MigrationStageKey[] = MIGRATION_STAGES.map((s) => s.key);
