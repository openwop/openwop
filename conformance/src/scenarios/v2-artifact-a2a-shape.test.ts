/**
 * v2-artifact-a2a-shape — RFC 0205 §A, the behavioural legs (suite 2.36.0,
 * target major 2).
 *
 * `getArtifact` (`GET /runs/{runId}/artifacts/{artifactId}`) MAY answer an A2A
 * `Artifact` when the client's `Accept` prefers `application/a2a+json`. The
 * discriminator is the response `Content-Type`: a `200` served as
 * `application/a2a+json` MUST validate against `schemas/v2/artifact.schema.json`,
 * its `artifactId` MUST equal the path segment, and a `url` Part in it MUST NOT
 * resolve beyond the caller's `artifacts:read` authorization.
 *
 * The suite needs an artifact it can name, so the legs run inside the
 * `conformance-artifact-emit` fixture (one node that produces one artifact and
 * emits `artifact.created`). Gates, decided before any assertion so a skipped
 * leg never records a partial witness:
 *   - the fixture is not advertised ⇒ `inapplicable`;
 *   - the host answers `application/json` (it MAY; SHOULD offer the A2A shape)
 *     ⇒ `inapplicable`, never a pass;
 *   - the `url` leg: no `url` Part in the body ⇒ `inapplicable`; a `url` Part
 *     but no `OPENWOP_TEST_TENANT_B_API_KEY` ⇒ `blocked`.
 * The server-free legs (the schemas against A2A v1.0.1) are corpus rows in
 * `src/coherence/a2a-parts-schemas.test.ts`.
 *
 * @see RFCS/0205-run-artifacts-and-turns-speak-a2a-parts.md
 * @see spec/v2/core/runs.md §"Annotations, artifacts, eval summary"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
const FIXTURE = 'conformance-artifact-emit';
const A2A = 'application/a2a+json';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function waitTerminal(runId: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    const status = res.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
    if (status !== null && TERMINAL.has(status)) return status;
    if (Date.now() > deadline) return status;
    await new Promise((r) => setTimeout(r, 200));
  }
}

type Read = { runId: string; artifactId: string; status: number; contentType: string; body: unknown };
type Gate = { ok: true; read: Read } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

let memo: Promise<Gate> | undefined;
/** One run, one artifact, one negotiated read — shared by both legs. */
function negotiatedRead(): Promise<Gate> {
  memo ??= (async (): Promise<Gate> => {
    const doc = await v2Discovery();
    if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(FIXTURE)) return { ok: false, kind: 'inapplicable', reason: `no artifact-producing fixture: the host does not advertise ${FIXTURE} (RFC 0205 register G2)` };
    const create = await driver.post('/runs', { workflowId: FIXTURE });
    if (create.status !== 201) return { ok: false, kind: 'blocked', reason: `POST /runs {workflowId: ${FIXTURE}} answered ${create.status}` };
    const runId = String((create.json as { runId?: unknown } | null)?.runId ?? '');
    const status = await waitTerminal(runId, 15_000);
    if (status !== 'completed') return { ok: false, kind: 'blocked', reason: `${FIXTURE} did not complete (status ${status})` };
    const poll = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
    const events = ((poll.json as { events?: unknown } | null)?.events ?? []) as Json[];
    const created = Array.isArray(events) ? events.find((e) => e['type'] === 'artifact.created') : undefined;
    const artifactId = String(((created?.['payload'] ?? {}) as Json)['artifactId'] ?? '');
    if (!artifactId) return { ok: false, kind: 'blocked', reason: `${FIXTURE} completed without an artifact.created event naming an artifactId` };
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`, { headers: { Accept: `${A2A}, application/json;q=0.5` } });
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return { ok: true, read: { runId, artifactId, status: res.status, contentType, body: res.json } };
  })();
  return memo;
}

describe('RFC 0205 §A.2 — an application/a2a+json artifact read is an A2A Artifact', () => {
  it('a getArtifact answered as application/a2a+json validates against artifact.schema.json', async () => {
    const g = await negotiatedRead();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { status, contentType, body } = g.read;
    if (status === 404 || status === 405) return softSkip('inapplicable', `getArtifact answered ${status} for the artifact the fixture announced — the read is not implemented`);
    if (status === 200 && contentType === 'application/json') return softSkip('inapplicable', 'host does not serve application/a2a+json (SHOULD); it answered application/json, whose shape is implementation-defined');
    expect(status, req('openwop.requirement.0205.artifact-a2a-shape', 'spec/v2/core/runs.md', `getArtifact for an artifact the run announced MUST answer 200 (got ${status}, ${contentType})`)).toBe(200);
    expect(contentType, req('openwop.requirement.0205.artifact-a2a-shape', 'RFC 0205 §A.1', `a 200 is application/json or ${A2A}; got ${contentType}`)).toBe(A2A);
    const r = v2Validator('artifact')(body);
    expect(r.ok, req('openwop.requirement.0205.artifact-a2a-shape', 'RFC 0205 §A.2', `a body served as ${A2A} MUST validate against schemas/v2/artifact.schema.json: ${r.errors}`)).toBe(true);
  });

  it('the artifactId of an application/a2a+json body equals the {artifactId} path segment', async () => {
    const g = await negotiatedRead();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { artifactId, status, contentType, body } = g.read;
    if (status !== 200 || contentType !== A2A) return softSkip('inapplicable', `no ${A2A} artifact body to compare (status ${status}, ${contentType || 'no content type'}); the host does not serve the A2A shape (SHOULD)`);
    expect(body !== null && typeof body === 'object', req('openwop.requirement.0205.artifact-id-matches-path', 'RFC 0205 §A.2', 'an application/a2a+json body is a JSON object')).toBe(true);
    expect((body as Json)['artifactId'], req('openwop.requirement.0205.artifact-id-matches-path', 'RFC 0205 §A.2', 'the body artifactId MUST equal the {artifactId} path segment')).toBe(artifactId);
  });
});

describe('RFC 0205 §A.3 — a url Part does not resolve beyond the caller\'s authorization', () => {
  it('the url of a url Part answers no 2xx to a second tenant or to no credential', async () => {
    const g = await negotiatedRead();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { status, contentType, body } = g.read;
    if (status !== 200 || contentType !== A2A) return softSkip('inapplicable', `no ${A2A} artifact body to read a url Part from (status ${status}, ${contentType || 'no content type'})`);
    const parts = Array.isArray((body as Json)['parts']) ? ((body as Json)['parts'] as Json[]) : [];
    const urls = parts.map((p) => p['url']).filter((u): u is string => typeof u === 'string');
    if (urls.length === 0) return softSkip('inapplicable', 'the artifact carries no url Part (the host emits data/text/raw Parts only; RFC 0205 register G3)');
    const tenantB = process.env['OPENWOP_TEST_TENANT_B_API_KEY'];
    if (!tenantB) return softSkip('blocked', 'the artifact carries a url Part but OPENWOP_TEST_TENANT_B_API_KEY is not supplied — the second-tenant leg cannot run');
    const base = loadEnv().baseUrl;
    for (const u of urls) {
      const abs = new URL(u, base).toString();
      const asB = await fetch(abs, { headers: { Authorization: `Bearer ${tenantB}` }, redirect: 'manual' });
      expect(asB.status >= 200 && asB.status < 300, req('openwop.requirement.0205.artifact-url-part-scoped', 'RFC 0205 §A.3', `${abs} MUST NOT answer 2xx to tenant B's credential (got ${asB.status})`)).toBe(false);
      const anon = await fetch(abs, { redirect: 'manual' });
      expect(anon.status >= 200 && anon.status < 300, req('openwop.requirement.0205.artifact-url-part-scoped', 'RFC 0205 §A.3', `${abs} MUST NOT answer 2xx with no credential (got ${anon.status})`)).toBe(false);
    }
  });
});
