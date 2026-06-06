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
