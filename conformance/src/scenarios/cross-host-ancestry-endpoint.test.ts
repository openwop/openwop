/**
 * cross-host-ancestry-endpoint — RFC 0040 §C `GET /v1/runs/{runId}/ancestry` behavioral.
 *
 * Status: ACTIVE (capability-gated behavioral). Gated on
 * `capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported: true`.
 * Hosts that don't advertise the endpoint soft-skip; hosts that DO
 * advertise MUST serve the endpoint with the documented response shape.
 *
 * Asserts:
 *
 *   1. Top-level run (no parent dispatch): `GET /v1/runs/{runId}/ancestry`
 *      returns 200 with body `{runId, hostId, parent: null}`.
 *
 *   2. Response shape conforms to `schemas/run-ancestry-response.schema.json`:
 *      `runId` matches the request path; `hostId` matches the host's
 *      advertised `crossHostCausation.hostId`; `parent` is either null OR
 *      an object with `{runId, hostId, cause}` required + optional
 *      `wellKnownUrl` (present for cross-host parents).
 *
 *   3. (Behavioral, soft-skip if no cross-host fixture) Cross-host
 *      parent: a run dispatched from a different host's MCP tool call OR
 *      A2A message returns `parent.wellKnownUrl` set + `parent.cause` ∈
 *      {mcp-tool-call, a2a-message}. Lands when a cross-host test
 *      fixture ships.
 *
 *   4. Hosts that advertise `crossHostCausation.supported: true` but NOT
 *      `ancestryEndpointSupported: true` MUST return 404 from the
 *      endpoint (per spec/v1/multi-agent-execution.md §"GET /v1/runs/{runId}/ancestry").
 *
 * @see RFCS/0040-multi-agent-cross-host-causation.md §C
 * @see spec/v1/multi-agent-execution.md §"GET /v1/runs/{runId}/ancestry endpoint"
 * @see schemas/run-ancestry-response.schema.json
 * @see api/openapi.yaml §getRunAncestry
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        crossHostCausation?: {
          supported?: unknown;
          hostId?: unknown;
          ancestryEndpointSupported?: unknown;
        };
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('cross-host-ancestry-endpoint: behavioral (RFC 0040 §C)', () => {
  it('hosts advertising ancestryEndpointSupported MUST serve GET /v1/runs/{runId}/ancestry with the documented shape on a top-level run', async () => {
    const d = await readDiscovery();
    const chc = d?.capabilities?.multiAgent?.executionModel?.crossHostCausation;
    if (chc?.ancestryEndpointSupported !== true) return; // soft-skip — host doesn't advertise

    // Create a fresh top-level run via the host's conformance-dispatch-loop
    // fixture (any always-on fixture works; the ancestry semantics don't
    // depend on the specific workflow).
    const create = await driver.post('/v1/runs', { workflowId: 'conformance-dispatch-loop' });
    if (create.status !== 201) return; // soft-skip — fixture absent or unauthorized
    const runId = (create.json as { runId: string }).runId;

    const ancestryRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/ancestry`);
    expect(ancestryRes.status, driver.describe(
      'RFCS/0040-multi-agent-cross-host-causation.md §C',
      'host advertising ancestryEndpointSupported MUST serve the endpoint (200) — 404 is non-conformant',
    )).toBe(200);

    const body = ancestryRes.json as { runId?: string; hostId?: string; parent?: unknown };
    expect(body.runId, 'runId in response MUST match the request path').toBe(runId);
    expect(
      typeof body.hostId === 'string' && (body.hostId as string).length >= 1,
      'hostId MUST be present + non-empty',
    ).toBe(true);
    if (chc.hostId !== undefined) {
      expect(
        body.hostId,
        'hostId in response MUST equal the host\'s advertised crossHostCausation.hostId',
      ).toBe(chc.hostId);
    }

    // Top-level run: parent is null.
    expect(
      body.parent,
      driver.describe(
        'RFCS/0040-multi-agent-cross-host-causation.md §C + schemas/run-ancestry-response.schema.json',
        'a top-level run (not dispatched from any other run) MUST return parent: null',
      ),
    ).toBeNull();
  });

  it('hosts advertising crossHostCausation.supported but NOT ancestryEndpointSupported MUST return 404 from the ancestry endpoint', async () => {
    const d = await readDiscovery();
    const chc = d?.capabilities?.multiAgent?.executionModel?.crossHostCausation;
    if (chc?.supported !== true) return; // soft-skip
    if (chc.ancestryEndpointSupported === true) return; // covered by the test above

    // Use any runId — even a synthetic non-existent one. The endpoint should
    // 404 regardless of run existence when the capability is not advertised.
    const ancestryRes = await driver.get('/v1/runs/synthetic-test-run-id/ancestry');
    expect(
      ancestryRes.status,
      driver.describe(
        'spec/v1/multi-agent-execution.md §"GET /v1/runs/{runId}/ancestry endpoint"',
        'hosts that advertise crossHostCausation.supported: true but NOT ancestryEndpointSupported MUST return 404 — the endpoint is opt-in even within Phase 3',
      ),
    ).toBe(404);
  });
});
