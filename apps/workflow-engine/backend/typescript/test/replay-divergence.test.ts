/**
 * Replay divergence detection (`src/executor/replayDivergence.ts`) +
 * an end-to-end replay round-trip proving the host honestly advertises
 * `capabilities.replay.supported` and re-executes deterministically.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { compareObservableSequences } from '../src/executor/replayDivergence.js';
import type { EventRecord } from '../src/types.js';

function ev(seq: number, type: string, nodeId?: string): EventRecord {
  return {
    eventId: `e${seq}`,
    runId: 'r',
    sequence: seq,
    type,
    ...(nodeId ? { nodeId } : {}),
    payload: {},
    timestamp: new Date(seq * 1000).toISOString(),
  };
}

describe('compareObservableSequences', () => {
  it('reports no divergence for identical structural sequences', () => {
    const a = [ev(0, 'run.started'), ev(1, 'node.started', 'op'), ev(2, 'node.completed', 'op'), ev(3, 'run.completed')];
    const b = a.map((e, i) => ({ ...e, eventId: `b${i}` }));
    expect(compareObservableSequences(a, b).diverged).toBe(false);
  });

  it('ignores recorded-fact / cost events (memory.written, provider.usage)', () => {
    const source = [
      ev(0, 'run.started'),
      ev(1, 'node.started', 'op'),
      ev(2, 'provider.usage', 'op'),
      ev(3, 'node.completed', 'op'),
      ev(4, 'run.completed'),
      ev(5, 'memory.written'),
    ];
    // replay omits the recorded-fact + cost events but matches structurally
    const replay = [
      ev(0, 'run.started'),
      ev(1, 'node.started', 'op'),
      ev(2, 'node.completed', 'op'),
      ev(3, 'run.completed'),
    ];
    expect(compareObservableSequences(source, replay).diverged).toBe(false);
  });

  it('flags divergence at the first structural mismatch', () => {
    const source = [ev(0, 'run.started'), ev(1, 'node.started', 'op'), ev(2, 'node.completed', 'op'), ev(3, 'run.completed')];
    const replay = [ev(0, 'run.started'), ev(1, 'node.started', 'op'), ev(2, 'node.failed', 'op'), ev(3, 'run.failed')];
    const r = compareObservableSequences(source, replay);
    expect(r.diverged).toBe(true);
    expect(r.index).toBe(2);
    expect(r.expected).toBe('node.completed@op');
    expect(r.actual).toBe('node.failed@op');
  });

  it('flags divergence when replay is truncated', () => {
    const source = [ev(0, 'run.started'), ev(1, 'node.started', 'op'), ev(2, 'run.completed')];
    const replay = [ev(0, 'run.started'), ev(1, 'node.started', 'op')];
    const r = compareObservableSequences(source, replay);
    expect(r.diverged).toBe(true);
    expect(r.index).toBe(2);
    expect(r.actual).toBeUndefined();
  });
});

describe('replay round-trip (end-to-end)', () => {
  let server: http.Server;
  const PORT = 18231;
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
    const app = await createApp({
      port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false,
    });
    await new Promise<void>((res) => { server = app.listen(PORT, res); });
  });
  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
  });

  const jf = async <T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> => {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: 'Bearer sample-token', ...(init.headers ?? {}) },
    });
    return { status: r.status, body: (await r.json()) as T };
  };
  const waitTerminal = async (id: string): Promise<string> => {
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const s = (await jf<{ status: string }>(`/v1/runs/${id}`)).body.status;
      if (['completed', 'failed', 'cancelled'].includes(s)) return s;
    }
    return 'timeout';
  };

  it('advertises replay.supported = true (and fork = false) honestly', async () => {
    const { body } = await jf<Record<string, unknown>>('/.well-known/openwop');
    // recursively locate the `replay` capability block
    let replay: { supported?: boolean; fork?: boolean } | undefined;
    const visit = (o: unknown): void => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (k === 'replay' && v && typeof v === 'object' && 'supported' in v) replay = v as typeof replay;
        else visit(v);
      }
    };
    visit(body);
    expect(replay?.supported).toBe(true);
    expect(replay?.fork).toBe(false);
  });

  it('advertises the experimental x-host-openwop-workforce block (gated, honest)', async () => {
    const { body } = await jf<Record<string, unknown>>('/.well-known/openwop');
    const wf = body['x-host-openwop-workforce'] as
      | { tier?: string; workforces?: { supported?: boolean }; assurance?: { replay?: boolean; evals?: boolean } }
      | undefined;
    expect(wf?.tier).toBe('experimental');
    expect(wf?.workforces?.supported).toBe(true);
    expect(wf?.assurance?.replay).toBe(true); // consistent with the replay family
    expect(wf?.assurance?.evals).toBe(false); // EP2, honestly absent
  });

  it('full replay of a deterministic run reproduces it with no replay.diverged', async () => {
    await jf('/v1/host/sample/workflows', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'wf.det.replay',
        nodes: [{ nodeId: 'op', typeId: 'core.db.nosql-insert', config: { datasource: 'ds', collection: 'c' } }],
        edges: [],
      }),
    });
    const create = await jf<{ runId: string }>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ workflowId: 'wf.det.replay', inputs: { docs: [{ name: 'Ada' }] } }),
    });
    expect(create.status).toBe(201);
    expect(await waitTerminal(create.body.runId)).toBe('completed');

    const fork = await jf<{ runId: string }>(`/v1/runs/${create.body.runId}:fork`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'replay', fromSeq: 0 }),
    });
    expect(fork.status).toBe(201);
    expect(await waitTerminal(fork.body.runId)).toBe('completed');

    // divergence detection runs after completion; poll the bundle for it
    let diverged = true;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const bundle = (await jf<{ events?: { type: string }[] }>(`/v1/runs/${fork.body.runId}/debug-bundle`)).body;
      const evs = bundle.events ?? [];
      if (evs.some((e) => e.type === 'run.completed')) {
        diverged = evs.some((e) => e.type === 'replay.diverged');
        break;
      }
    }
    expect(diverged).toBe(false);
  });
});
