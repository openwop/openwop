/**
 * Agent-scoped scheduler client (host extension; RFC 0052 reference impl).
 *
 *   GET    /v1/host/sample/scheduler/jobs[?rosterId=]      → { jobs }
 *   POST   /v1/host/sample/scheduler/jobs                  → job
 *   PATCH  /v1/host/sample/scheduler/jobs/:jobId           → job   (enable/disable)
 *   DELETE /v1/host/sample/scheduler/jobs/:jobId
 *   POST   /v1/host/sample/scheduler/jobs/:jobId/trigger   → { runsFired, runId? }
 *
 * Tenant scoping is the backend's job; the client never sends a tenantId.
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';

export interface ScheduledJob {
  jobId: string;
  tenantId: string;
  cronExpr: string;
  lastFiredTick: number | null;
  workflowId?: string;
  rosterId?: string;
  agentId?: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  lastRunId?: string;
  /** ISO-8601 wall-clock time of the most recent fire. */
  lastRunAt?: string;
  /** IANA timezone the cadence is expressed in (informational). */
  timezone?: string;
  createdAt?: string;
}

const base = `${config.baseUrl}/v1/host/sample/scheduler/jobs`;
const jsonHeaders = (): HeadersInit => authedHeaders({ 'content-type': 'application/json' });

/** List jobs, optionally filtered to one roster member (the agent's tab). */
export async function listJobs(rosterId?: string): Promise<ScheduledJob[]> {
  const url = rosterId ? `${base}?rosterId=${encodeURIComponent(rosterId)}` : base;
  const res = await fetch(url, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`listJobs returned ${res.status}`);
  return ((await res.json()) as { jobs: ScheduledJob[] }).jobs;
}

export async function createJob(input: {
  cronExpr: string;
  workflowId?: string;
  rosterId?: string;
  agentId?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  timezone?: string;
}): Promise<ScheduledJob> {
  const res = await fetch(base, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch { /* ignore */ }
    throw new Error(`createJob failed: ${detail}`);
  }
  return (await res.json()) as ScheduledJob;
}

/** Patch an editable subset of a schedule (cadence, workflow, label, timezone,
 *  enabled). Lets the UI edit in place rather than delete-and-recreate. */
export async function updateJob(
  jobId: string,
  patch: { enabled?: boolean; cronExpr?: string; workflowId?: string; metadata?: Record<string, unknown>; timezone?: string },
): Promise<ScheduledJob> {
  const res = await fetch(`${base}/${encodeURIComponent(jobId)}`, fetchOpts({ method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) }));
  if (!res.ok) throw new Error(`updateJob returned ${res.status}`);
  return (await res.json()) as ScheduledJob;
}

export async function setJobEnabled(jobId: string, enabled: boolean): Promise<ScheduledJob> {
  return updateJob(jobId, { enabled });
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`${base}/${encodeURIComponent(jobId)}`, fetchOpts({ method: 'DELETE', headers: authedHeaders() }));
  if (!res.ok) throw new Error(`deleteJob returned ${res.status}`);
}

export async function triggerJob(jobId: string): Promise<{ runsFired: number; runId?: string }> {
  const res = await fetch(`${base}/${encodeURIComponent(jobId)}/trigger`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: '{}' }));
  if (!res.ok) throw new Error(`triggerJob returned ${res.status}`);
  return (await res.json()) as { runsFired: number; runId?: string };
}

/** Map a UI cadence choice to a cron expression. */
export const CADENCE_PRESETS: ReadonlyArray<{ key: string; label: string; cronExpr: string }> = [
  { key: 'hourly', label: 'Hourly', cronExpr: '0 * * * *' },
  { key: 'daily', label: 'Daily (9:00 AM)', cronExpr: '0 9 * * *' },
  { key: 'weekdays', label: 'Weekdays (9:00 AM)', cronExpr: '0 9 * * 1-5' },
  { key: 'weekly', label: 'Weekly (Mon 9:00 AM)', cronExpr: '0 9 * * 1' },
];
