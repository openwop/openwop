/**
 * Sample-extension scheduler CRUD route — /v1/host/sample/scheduler/jobs.
 *
 * Exercises the list/create/delete/trigger surface (C-6) backed by the RFC
 * 0052 scheduling service. Verifies:
 *   - create → list round-trips a job
 *   - trigger fires the job once (RFC 0052 §B.2 fire-once-per-tick)
 *   - delete removes the job; a second delete 404s
 *   - a firstFireAtMs beyond maxFutureHorizon is rejected with
 *     schedule_horizon_exceeded (RFC 0052 §B.3)
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { resetScheduling, MAX_FUTURE_HORIZON_MS } from '../src/host/schedulingService.js';

let server: http.Server;
const PORT = 18199;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

beforeEach(async () => {
  await resetScheduling();
});

async function jsonFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  const status = res.status;
  const text = await res.text();
  return { status, body: (text.length ? JSON.parse(text) : null) as T };
}

interface Job {
  jobId: string;
  cronExpr: string;
  workflowId?: string;
  lastFiredTick: number | null;
}

describe('scheduler CRUD route (C-6 / RFC 0052)', () => {
  it('creates a job and lists it back', async () => {
    const created = await jsonFetch<Job>('/v1/host/sample/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify({ jobId: 'job-a', cronExpr: '*/5 * * * *', workflowId: 'wf-a' }),
    });
    expect(created.status).toBe(201);
    expect(created.body.jobId).toBe('job-a');
    expect(created.body.cronExpr).toBe('*/5 * * * *');
    expect(created.body.workflowId).toBe('wf-a');

    const list = await jsonFetch<{ jobs: Job[] }>('/v1/host/sample/scheduler/jobs');
    expect(list.status).toBe(200);
    expect(list.body.jobs.some((j) => j.jobId === 'job-a')).toBe(true);
  });

  it('assigns a jobId when none is supplied', async () => {
    const created = await jsonFetch<Job>('/v1/host/sample/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify({ cronExpr: '0 9 * * *' }),
    });
    expect(created.status).toBe(201);
    expect(typeof created.body.jobId).toBe('string');
    expect(created.body.jobId.length).toBeGreaterThan(0);
  });

  it('rejects a create with no cronExpr (validation_error)', async () => {
    const res = await jsonFetch<{ error: string }>('/v1/host/sample/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify({ jobId: 'no-cron' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('rejects a schedule beyond maxFutureHorizon with schedule_horizon_exceeded', async () => {
    const res = await jsonFetch<{ error: string }>('/v1/host/sample/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify({
        jobId: 'far',
        cronExpr: '* * * * *',
        firstFireAtMs: Date.now() + MAX_FUTURE_HORIZON_MS + 60_000,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('schedule_horizon_exceeded');
  });

  it('triggers a job exactly once (RFC 0052 §B.2)', async () => {
    await jsonFetch('/v1/host/sample/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify({ jobId: 'job-t', cronExpr: '* * * * *' }),
    });
    const fired = await jsonFetch<{ runsFired: number; lastFiredTick: number }>(
      '/v1/host/sample/scheduler/jobs/job-t/trigger',
      { method: 'POST', body: '{}' },
    );
    expect(fired.status).toBe(200);
    expect(fired.body.runsFired).toBe(1);
    expect(fired.body.lastFiredTick).toBeGreaterThan(0);
  });

  it('404s a trigger for an unknown job', async () => {
    const res = await jsonFetch<{ error: string }>(
      '/v1/host/sample/scheduler/jobs/nope/trigger',
      { method: 'POST', body: '{}' },
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('deletes a job; a second delete 404s', async () => {
    await jsonFetch('/v1/host/sample/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify({ jobId: 'job-d', cronExpr: '* * * * *' }),
    });
    const first = await jsonFetch<{ removed: boolean }>(
      '/v1/host/sample/scheduler/jobs/job-d',
      { method: 'DELETE' },
    );
    expect(first.status).toBe(200);
    expect(first.body.removed).toBe(true);

    const second = await jsonFetch<{ error: string }>(
      '/v1/host/sample/scheduler/jobs/job-d',
      { method: 'DELETE' },
    );
    expect(second.status).toBe(404);
    expect(second.body.error).toBe('not_found');
  });
});
