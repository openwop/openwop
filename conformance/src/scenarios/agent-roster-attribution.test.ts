/**
 * Standing-agent roster attribution + ordering (RFC 0086 §B/§C) — behavioral.
 *
 * Gated on `capabilities.agents.roster.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true` via `behaviorGate`. The companion always-on
 * wire-shape coverage lives in `agent-roster-shape.test.ts`; this scenario
 * asserts host BEHAVIOR:
 *
 *   1. NORMATIVE read — `GET /v1/agents/roster` (RFC 0086 §B) returns the
 *      `agent-roster-response` shape (roster[] + `total == roster.length`), and
 *      every entry carries a `host:<id>` `rosterId`, a `persona`, an
 *      `agentRef.agentId`, and an `owner.tenantId`. Runs black-box against the
 *      normative path on any roster host.
 *   2. ATTRIBUTION + ORDERING (seam-gated) — a portfolio fire emits
 *      `roster.run.initiated` as the run's FIRST attribution event, BEFORE any
 *      `agent.invocation.*` / `agent.*` event (§C), content-free (no work-item
 *      `body`/`prompt`/credential — the `roster-attribution-no-content`
 *      invariant), with `rosterId`/`persona`/`agentId`/`workflowId`/
 *      `triggerSource`. A durable work-item fire additionally carries
 *      `triggerSubscriptionId` (RFC 0083) traceable on the run's `causationId`.
 *   3. TENANT SCOPING (§B / RFC 0074) — a `GET /v1/agents/roster/{id}` for an id
 *      outside the caller's owner triple 404s (probed only when a cross-tenant id
 *      is supplied via `OPENWOP_CROSS_TENANT_ROSTER_ID`; soft-skip otherwise).
 *
 * The fire + event-log seams are OPTIONAL (reference roster store deferred per
 * RFC 0086 §Conformance); each leg soft-skips independently so a host that
 * serves only the normative read still exercises leg 1.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-roster.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0086-standing-agent-roster-and-workflow-portfolio.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (roster-attribution-no-content)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readRosterCap, listRoster, getRosterEntry, fireRosterPortfolio } from '../lib/agentRoster.js';
import {
  queryTestEvents,
  isEventLogSeamAvailable,
  resetTestSeam,
  type TestEvent,
} from '../lib/event-log-query.js';

const ROSTER_ID_RE = /^host:[a-z0-9][a-z0-9._-]*$/;

/** Lowest-sequence event matching one of `types`; undefined when none present. */
function firstOf(events: TestEvent[], types: string[]): TestEvent | undefined {
  return events
    .filter((e) => types.includes(e.type))
    .sort((a, b) => a.sequence - b.sequence)[0];
}

describe('agent-roster-attribution (RFC 0086 §B/§C)', () => {
  it('serves the normative roster, attributes a portfolio fire content-free + ordered, and tenant-scopes', async () => {
    const cap = await readRosterCap();
    if (!behaviorGate('openwop-roster-attribution', cap?.supported === true)) return;

    // RFC 0074 carry-forward: installScope MUST be host|tenant when present.
    const installScope = typeof cap?.installScope === 'string' ? cap.installScope : 'host';
    expect(
      installScope === 'host' || installScope === 'tenant',
      driver.describe('RFC 0086 §F / RFC 0074 §B', "agents.roster.installScope (when present) MUST be 'host' or 'tenant'"),
    ).toBe(true);

    // ---- Leg 1: normative read (black-box on any roster host) -------------
    const body = await listRoster();
    if (body === null) return; // host advertises roster but doesn't serve the read yet — soft-skip
    const roster = body.roster ?? [];
    expect(
      Array.isArray(roster),
      driver.describe('agent-roster.md §B', 'GET /v1/agents/roster MUST return a roster[] array'),
    ).toBe(true);
    expect(
      body.total === roster.length,
      driver.describe('agent-roster-response.schema.json', 'total MUST equal roster.length'),
    ).toBe(true);
    for (const entry of roster) {
      expect(
        typeof entry.rosterId === 'string' && ROSTER_ID_RE.test(entry.rosterId),
        driver.describe('agent-roster-entry.schema.json', 'each entry MUST carry a host:<id> rosterId'),
      ).toBe(true);
      expect(
        typeof entry.persona === 'string' && entry.persona.length > 0,
        driver.describe('agent-roster.md §A', 'each entry MUST carry a non-empty persona'),
      ).toBe(true);
      expect(
        typeof entry.agentRef?.agentId === 'string',
        driver.describe('agent-roster.md §A', 'each entry MUST reference an agentRef.agentId'),
      ).toBe(true);
      expect(
        typeof entry.owner?.tenantId === 'string',
        driver.describe('agent-roster.md §B / RFC 0074', 'each entry MUST carry an owner.tenantId scope'),
      ).toBe(true);
      // RFC 0082 §A XOR: an agentRef MUST NOT pin both version and channel.
      expect(
        !(entry.agentRef?.version !== undefined && entry.agentRef?.channel !== undefined),
        driver.describe('RFC 0082 §A', 'agentRef MUST NOT carry both version and channel'),
      ).toBe(true);
    }

    // ---- Leg 2: attribution + ordering (seam-gated) ----------------------
    if (await isEventLogSeamAvailable()) {
      // Scheduled portfolio fire.
      const fired = await fireRosterPortfolio({ triggerSource: 'schedule' });
      if (fired?.runId) {
        const q = await queryTestEvents(fired.runId);
        if (q.ok) {
          const init = firstOf(q.events, ['roster.run.initiated']);
          expect(
            init !== undefined,
            driver.describe('agent-roster.md §C', 'a portfolio fire MUST emit roster.run.initiated'),
          ).toBe(true);

          if (init) {
            // Ordering: roster.run.initiated precedes ANY agent invocation/event.
            const firstAgent = firstOf(q.events, [
              'agent.invocation.started',
              'agent.reasoned',
              'agent.decided',
            ]);
            if (firstAgent) {
              expect(
                init.sequence < firstAgent.sequence,
                driver.describe('agent-roster.md §C', 'roster.run.initiated MUST precede any agent.* event in the run'),
              ).toBe(true);
            }

            // Content-free: required ids present; NO work-item body/prompt/credential.
            const p = init.payload;
            for (const key of ['rosterId', 'persona', 'agentId', 'workflowId', 'triggerSource']) {
              expect(
                typeof p[key] === 'string' && (p[key] as string).length > 0,
                driver.describe('run-event-payloads.schema.json#rosterRunInitiated', `roster.run.initiated MUST carry ${key}`),
              ).toBe(true);
            }
            for (const forbidden of ['body', 'prompt', 'input', 'payload', 'apiKey', 'secret', 'credentials', 'token']) {
              expect(
                !(forbidden in p),
                driver.describe('SECURITY roster-attribution-no-content', `roster.run.initiated MUST be content-free (no ${forbidden})`),
              ).toBe(true);
            }
            expect(
              typeof p.rosterId === 'string' && ROSTER_ID_RE.test(p.rosterId),
              driver.describe('agent-roster.md §C', 'roster.run.initiated.rosterId MUST be a host:<id> AgentRef id'),
            ).toBe(true);
          }
        }
      }

      // Durable work-item fire: carries the RFC 0083 triggerSubscriptionId + causation.
      const work = await fireRosterPortfolio({ triggerSource: 'webhook', asWorkItem: true });
      if (work?.runId) {
        const q = await queryTestEvents(work.runId, { type: 'roster.run.initiated' });
        if (q.ok && q.events[0]) {
          const p = q.events[0].payload;
          expect(
            typeof p.triggerSubscriptionId === 'string' && (p.triggerSubscriptionId as string).length > 0,
            driver.describe('agent-roster.md §D / RFC 0083', 'a durable work-item fire MUST carry triggerSubscriptionId for trigger→run→roster ancestry'),
          ).toBe(true);
        }
      }

      await resetTestSeam();
    }

    // ---- Leg 3: tenant scoping (RFC 0074) --------------------------------
    const crossTenantId = process.env.OPENWOP_CROSS_TENANT_ROSTER_ID;
    if (typeof crossTenantId === 'string' && crossTenantId.length > 0) {
      const probe = await getRosterEntry(crossTenantId);
      expect(
        probe.status === 404,
        driver.describe('agent-roster.md §B / RFC 0074', "GET /v1/agents/roster/{id} for a cross-tenant id MUST 404 (no cross-tenant disclosure)"),
      ).toBe(true);
    }
  });
});
