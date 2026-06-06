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
