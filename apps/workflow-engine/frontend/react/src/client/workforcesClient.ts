/**
 * Governed Workforce client — wraps the sample host-extension surface
 * `GET /v1/host/sample/workforces`, `/:id`, `/:id/metrics` (EP0).
 *
 * Read-only in EP0. Raw fetch (the surface is a host extension, not in the
 * SDK), mirroring the accessClient/runsClient pattern. Shapes mirror the
 * backend `Workforce` + `WorkforceMetrics` — the frontend can't import backend
 * types, so they're declared locally and kept in lockstep by review.
 */

import { authedHeaders, config, fetchOpts } from './config.js';

const base = `${config.baseUrl}/v1/host/sample/workforces`;

export type AutonomyLevel = 'review' | 'guided' | 'auto';
export type WorkforceStatus = 'shadow' | 'piloting' | 'production';

export interface WorkforceAgentSpec {
  agentRef: string;
  role: 'supervisor' | 'worker' | 'governance';
  autonomyLevel: AutonomyLevel;
  dataBoundary: string;
  decisionBoundary: string;
  memoryBoundary: string;
  performanceTarget: string;
  recoveryBehavior: string;
}

export interface Workforce {
  workforceId: string;
  name: string;
  businessFunction: string;
  status: WorkforceStatus;
  purpose: { statement: string; policyTags: string[]; refusalBoundaries: string[] };
  autonomyLevel: AutonomyLevel;
  dataManifestId: string;
  successMetrics: string[];
  workflowCatalog: string[];
  agents: WorkforceAgentSpec[];
  decisionBoundaries: { auto: string[]; review: string[] };
}

export interface WorkforceMetrics {
  workforceId: string;
  totalRuns: number;
  terminalRuns: number;
  openApprovals: number;
  cycleTimeP50Ms: number | null;
  costPerClearedUsd: number | null;
  escalationRate: number;
  overrideRate: number;
  falsePositiveRate: number;
  recoveryRate: number;
  policyViolations: number;
  weekly: { week: number; runs: number; overrideRate: number; avgCostUsd: number }[];
}

async function asJson<T>(res: Response, ctx: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string }; message?: string };
      detail = body?.error?.message ?? body?.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `${ctx} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

/** List workforce definitions. Empty array when none seeded. */
export async function listWorkforces(): Promise<Workforce[]> {
  const res = await fetch(base, fetchOpts({ headers: authedHeaders() }));
  return (await asJson<{ workforces: Workforce[] }>(res, 'listWorkforces')).workforces ?? [];
}

/** One workforce bundle, or null on 404. */
export async function getWorkforce(workforceId: string): Promise<Workforce | null> {
  const res = await fetch(`${base}/${encodeURIComponent(workforceId)}`, fetchOpts({ headers: authedHeaders() }));
  if (res.status === 404) return null;
  return asJson<Workforce>(res, 'getWorkforce');
}

/** Aggregate telemetry for the caller's tenant. */
export async function getWorkforceMetrics(workforceId: string): Promise<WorkforceMetrics> {
  const res = await fetch(`${base}/${encodeURIComponent(workforceId)}/metrics`, fetchOpts({ headers: authedHeaders() }));
  return asJson<WorkforceMetrics>(res, 'getWorkforceMetrics');
}

/** Cut over: change a workforce's status (MG-6). Production is gated server-side
 *  on autonomy graduation — a 409 surfaces as a thrown Error with the host's message. */
export async function updateWorkforceStatus(workforceId: string, status: WorkforceStatus): Promise<Workforce> {
  const res = await fetch(`${base}/${encodeURIComponent(workforceId)}`, fetchOpts({
    method: 'PATCH',
    headers: { ...authedHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  }));
  return asJson<Workforce>(res, 'updateWorkforceStatus');
}

// ── migration journey (EP1 MG-0) ───────────────────────────────────────────

export type MigrationStageKey =
  | 'target' | 'assess' | 'map-data' | 'map-boundaries' | 'shadow-prove' | 'cut-over';
export type StageStatus = 'pending' | 'done';

export interface MigrationJourney {
  workforceId: string;
  stageStatus: Record<MigrationStageKey, StageStatus>;
  target: { workflowId: string; targetOutcome: string } | null;
  dataManifest: { dataSources: string; sensitivity: string; approvalModel: string } | null;
  boundaries: { auto: string[]; review: string[] } | null;
  updatedAt: string;
}
export interface MigrationJourneyPatch {
  target?: MigrationJourney['target'];
  dataManifest?: MigrationJourney['dataManifest'];
  boundaries?: MigrationJourney['boundaries'];
  stageStatus?: Partial<Record<MigrationStageKey, StageStatus>>;
}

export async function getMigrationJourney(workforceId: string): Promise<MigrationJourney> {
  const res = await fetch(`${base}/${encodeURIComponent(workforceId)}/migration`, fetchOpts({ headers: authedHeaders() }));
  return asJson<MigrationJourney>(res, 'getMigrationJourney');
}

export async function patchMigrationJourney(workforceId: string, patch: MigrationJourneyPatch): Promise<MigrationJourney> {
  const res = await fetch(`${base}/${encodeURIComponent(workforceId)}/migration`, fetchOpts({
    method: 'PATCH',
    headers: { ...authedHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }));
  return asJson<MigrationJourney>(res, 'patchMigrationJourney');
}

// ── governance & graduated autonomy (EP1) ──────────────────────────────────

export interface PromotionMilestone {
  fromTier: AutonomyLevel | null;
  toTier: AutonomyLevel;
  atIso: string;
  runIndex: number;
  overrideIncidenceBefore: number | null;
  unlockThreshold: number | null;
}
export interface AutonomyGraduation {
  workforceId: string;
  currentTier: AutonomyLevel | null;
  milestones: PromotionMilestone[];
  nextTier: AutonomyLevel | null;
  nextThreshold: number | null;
  recentOverrideIncidence: number;
  eligibleForNext: boolean;
}
export interface GovernanceEvent {
  runId: string;
  atIso: string;
  kind: 'override' | 'false-positive' | 'recovery';
  detail: string;
}
export interface GovernancePosture {
  workforceId: string;
  totalRuns: number;
  overrides: number;
  escalations: number;
  falsePositives: number;
  recoveries: number;
  policyViolations: number;
  recentEvents: GovernanceEvent[];
}
export interface WorkforceGovernance {
  autonomy: AutonomyGraduation;
  posture: GovernancePosture;
}

/** Graduated-autonomy timeline + governance posture for the caller's tenant. */
export async function getWorkforceGovernance(workforceId: string): Promise<WorkforceGovernance> {
  const res = await fetch(`${base}/${encodeURIComponent(workforceId)}/governance`, fetchOpts({ headers: authedHeaders() }));
  return asJson<WorkforceGovernance>(res, 'getWorkforceGovernance');
}

// ── cross-run trace search (EP1 GA-2) ──────────────────────────────────────

export interface TraceMatch {
  runId: string;
  correlationId: string | null;
  batchId: string | null;
  outcome: string | null;
  status: string;
  startedAt: string;
}
export interface TraceSearchResult {
  query: string;
  matches: TraceMatch[];
  scanned: number;
  capped: boolean;
}

/** Search the workforce's runs by correlationId / batchId / runId / outcome / status. */
export async function searchWorkforceTrace(workforceId: string, q: string): Promise<TraceSearchResult> {
  const res = await fetch(
    `${base}/${encodeURIComponent(workforceId)}/trace?q=${encodeURIComponent(q)}`,
    fetchOpts({ headers: authedHeaders() }),
  );
  return asJson<TraceSearchResult>(res, 'searchWorkforceTrace');
}

// ── shadow & prove (EP1 MG-5 — RFC 0081 `live-shadow` EvalSummary, host-ext pilot) ─

export interface ShadowFinding {
  key: string;
  agentDigest: string;
  baselineDigest: string;
}
/** Mirrors RFC 0081's `EvalSummary` (live-shadow mode), simplified. */
export interface ShadowEvalSummary {
  workforceId: string;
  mode: 'live-shadow';
  aggregateScore: number; // agreement with baseline ∈ [0,1]
  passed: boolean;
  status: 'pass' | 'fail' | 'pending';
  overrideRate: number;
  divergenceCount: number;
  findings: ShadowFinding[];
  baseline: { mode: 'external'; runId: string | null };
}

/** RFC 0081 live-shadow EvalSummary over the workforce's runs (host-ext pilot). */
export async function getWorkforceShadow(workforceId: string): Promise<ShadowEvalSummary> {
  const res = await fetch(`${base}/${encodeURIComponent(workforceId)}/shadow`, fetchOpts({ headers: authedHeaders() }));
  return asJson<ShadowEvalSummary>(res, 'getWorkforceShadow');
}

// ── real live-shadow eval RUN (RFC 0081 §C — host-ext, gated) ──────────────

export interface EvalTaskResult {
  taskId: string;
  score: number;
  passed: boolean;
}
/** The result of an actual eval RUN (dispatches the agent over a suite), vs the
 *  runs-derived ShadowEvalSummary. Mirrors RFC 0081 `EvalSummary`. */
export interface WorkforceEvalSummary {
  runId: string;
  workforceId: string;
  suiteId: string;
  suiteVersion: string;
  mode: 'live-shadow';
  aggregateScore: number;
  passed: boolean;
  taskCount: number;
  passedCount: number;
  evaluatedModelClass: string;
  tasks: EvalTaskResult[];
}

/** Sentinel thrown when the host doesn't enable the eval suite (501). */
export class EvalNotEnabledError extends Error {}

/** Run a real live-shadow eval. Throws {@link EvalNotEnabledError} on a 501
 *  (`OPENWOP_AGENT_EVAL_SUITE_ENABLED` off on this host). */
export async function runWorkforceEval(workforceId: string): Promise<WorkforceEvalSummary> {
  const res = await fetch(
    `${base}/${encodeURIComponent(workforceId)}/eval`,
    fetchOpts({ method: 'POST', headers: authedHeaders() }),
  );
  if (res.status === 501) throw new EvalNotEnabledError('eval suite not enabled on this host');
  return asJson<WorkforceEvalSummary>(res, 'runWorkforceEval');
}
