/**
 * Multi-Agent Shift Phase 3 — CTI-1 cross-tenant isolation invariant.
 *
 * Verifies the CTI-1 normative invariant: a `memoryRef` resolved by a
 * MemoryAdapter MUST return entries scoped to a single tenant. If
 * `memoryRef` is associated with tenant T, no `list` or `get` call
 * against `memoryRef` MAY return entries belonging to tenant T' ≠ T,
 * regardless of the calling principal's permissions on T'.
 *
 * Capability-gated: skips when host doesn't advertise long-term memory.
 * Fixture-gated: requires `conformance-agent-memory-cross-tenant`
 * (intentionally constructs a cross-tenant probe).
 *
 * @see docs/MULTI-AGENT-INTEGRATION-GAPS.md §`Phase 3`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { hasLongTermMemory } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-memory-cross-tenant';
const SKIP = !hasLongTermMemory() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentMemoryCrossTenantIsolation: CTI-1 invariant', () => {
  it('cross-tenant memoryRef returns empty / null — no leak across tenant boundary', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    // Fixture either completes (cross-tenant probe returned empty, as
    // expected) or fails with a security-related error. Both are
    // CTI-1-compliant; what MUST NOT happen is `completed` + leaked
    // entries surfacing in the run's variables.
    expect(['completed', 'failed']).toContain(terminal.status);

    if (terminal.status === 'completed') {
      const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const body = snap.json as { variables?: Record<string, unknown> };
      const crossTenantResult = body.variables?.crossTenantProbe as
        | Array<unknown>
        | null
        | undefined;
      // Cross-tenant list MUST return [] (or null); never another tenant's entries.
      if (Array.isArray(crossTenantResult)) {
        expect(crossTenantResult.length).toBe(0);
      } else {
        expect(crossTenantResult).toBeFalsy();
      }
    }
  });
});
