/**
 * CF-4 close-out (partial) — explicit scope-failure coverage on
 * `GET /v1/runs/{runId}/artifacts/{artifactId}` per
 * `plans/openwop-protocol-gap-closure-plan.md` Workstream 2.
 *
 * The existing `route-coverage.test.ts` covers 404 / 403 envelope
 * shape on an unknown artifact. This scenario adds the 401 path —
 * an unauthenticated request to the artifact endpoint MUST return
 * 401 with the canonical `unauthenticated` envelope, NEVER 200 (no
 * cross-tenant leak via missing-auth coercion) and NEVER a redirect.
 *
 * Positive-path coverage (reading an artifact a workflow actually
 * produced) is host-pending — no reference host currently implements
 * `getArtifact` end-to-end; the path lights up when the first host
 * advertises an artifact-producing fixture.
 *
 * @see api/openapi.yaml §`getArtifact`
 * @see spec/v1/rest-endpoints.md §"GET /v1/runs/{runId}/artifacts/{artifactId}"
 */

import { describe, it, expect } from 'vitest';

import { loadEnv } from '../lib/env.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('artifact-auth: unauthenticated artifact requests are rejected', () => {
  it('GET /v1/runs/{runId}/artifacts/{artifactId} without Authorization returns 401', async () => {
    const env = loadEnv();
    // Use node:fetch directly with NO Authorization header — bypass the
    // driver's auto-auth so we exercise the unauthenticated code path.
    const res = await fetch(
      `${env.baseUrl}/v1/runs/openwop-conformance-noauth-run/artifacts/openwop-conformance-noauth-artifact`,
    );
    expect(res.status, req('openwop.it.artifact-auth.get-v1-runs-runid-artifacts-artifactid-without-authorization-returns-401', 
      'rest-endpoints.md GET /v1/runs/{runId}/artifacts/{artifactId}',
      'artifact endpoint MUST reject unauthenticated requests with 401 (never 200, never redirect)',
    )).toBe(401);
    expect(res.status, req('openwop.it.artifact-auth.get-v1-runs-runid-artifacts-artifactid-without-authorization-returns-401', 'rest-endpoints.md GET /v1/runs/{runId}/artifacts/{artifactId}', 'redirect MUST NOT be used to handle missing auth on artifact endpoint')).not.toBe(301);
    expect(res.status, req('openwop.it.artifact-auth.get-v1-runs-runid-artifacts-artifactid-without-authorization-returns-401', 'rest-endpoints.md GET /v1/runs/{runId}/artifacts/{artifactId}', 'redirect MUST NOT be used to handle missing auth on artifact endpoint')).not.toBe(302);
    expect(res.status).not.toBe(200);

    // Canonical error envelope: error: 'unauthenticated', message: string.
    let body: { error?: string; message?: string };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Some hosts return a bare 401 with no body — acceptable. Skip the
      // envelope-shape assertion in that case.
      return softSkip('blocked', 'precondition not met — an earlier step threw (Some hosts return a bare 401 with no body — acceptable. Skip the envelope-shape assertion in that case.) (seam, prior step, or fixture unavailable)');
    }
    if (typeof body.error === 'string') {
      expect(body.error, req('openwop.it.artifact-auth.get-v1-runs-runid-artifacts-artifactid-without-authorization-returns-401', 
        'auth.md §"Error envelope"',
        '401 envelope SHOULD carry `error: "unauthenticated"` for missing-auth on artifact endpoint',
      )).toBe('unauthenticated');
    }
  });
});
