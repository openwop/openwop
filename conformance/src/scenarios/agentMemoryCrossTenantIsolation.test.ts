/**
 * Multi-Agent Shift Phase 3 — CTI-1 cross-tenant isolation invariant.
 * Normative reference: RFCS/0004-memory-layer.md
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
      const vars = body.variables ?? {};

      // S35 (2026-08-17): POSITIVE CONTROL first. Before this, the only assertion
      // was "crossTenantProbe is empty or falsy" — a host whose core.identity node
      // ignored `config.memoryAction` entirely left the variable undefined and
      // PASSED a critical-tier invariant vacuously (measured by openwop-app H49).
      // The owner-side write+list proves the MemoryAdapter is really exercised.
      const ownerProbe = vars.ownerProbe;
      expect(
        Array.isArray(ownerProbe) && ownerProbe.length > 0,
        driver.describe('agent-memory.md §CTI-1 / fixtures.md conformance-agent-memory-cross-tenant', 'ownerProbe MUST be a NON-EMPTY array — the run\'s own tenant can read the entry it just wrote (positive control; an unset or empty ownerProbe means the probe never ran)'),
      ).toBe(true);
      const ownerEntryId = vars.ownerEntryId;
      if (typeof ownerEntryId === 'string' && ownerEntryId.length > 0) {
        expect(
          (ownerProbe as Array<{ id?: unknown }>).some((e) => e && typeof e === 'object' && e.id === ownerEntryId),
          driver.describe('agent-memory.md §CTI-1', `ownerProbe MUST contain the entry the host reports writing (ownerEntryId=${ownerEntryId})`),
        ).toBe(true);
      }

      // Cross-tenant list MUST return exactly [] (or null); never another
      // tenant's entries, and never left unset.
      const crossTenantResult = vars.crossTenantProbe;
      expect(
        crossTenantResult !== undefined,
        driver.describe('agent-memory.md §CTI-1', 'crossTenantProbe MUST be set — an unset variable means the cross-tenant probe was never issued, which proves nothing'),
      ).toBe(true);
      if (Array.isArray(crossTenantResult)) {
        expect(crossTenantResult.length, driver.describe('agent-memory.md §CTI-1', 'a cross-tenant memoryRef probe MUST return [] — no entries of another tenant')).toBe(0);
      } else {
        expect(crossTenantResult, driver.describe('agent-memory.md §CTI-1', 'a non-array cross-tenant probe result MUST be null')).toBeNull();
      }
    }
  });
});
