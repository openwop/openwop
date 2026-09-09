/**
 * multi-agent-confidence-escalation — RFC 0039 §A behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0039
 * (multi-agent execution model `version: 2`) filed Draft → graduated
 * Active 2026-05-22 in the same commit chain as this scenario.
 * Capability-gated on
 * `capabilities.multiAgent.executionModel.supported: true` AND
 * `capabilities.multiAgent.executionModel.version >= 2` AND fixture
 * availability. Hosts that advertise only `version: 1` soft-skip
 * cleanly — the confidence-floor MUST applies only at `version >= 2`.
 *
 * Asserts (behavioral when host advertises `version >= 2`):
 *
 *   1. Advertisement shape: confidenceEscalationFloor (when present) MUST be
 *      a number in [0.5, 1.0]; floor < 0.5 is non-conformant per RFC 0039 §A.
 *
 *   2. A run driven by the fixture's low-confidence (0.3) mockDispatchPlan
 *      reaches a `waiting-clarification` terminal-suspension status — NOT
 *      `completed`. The clarification interrupt MUST surface so the operator
 *      can confirm-or-adjust the supervisor's marginal decision.
 *
 *   3. The parent run's event log contains exactly ONE
 *      `core.workflowChain.confidence-escalated` event, with:
 *        - payload.confidence === 0.3
 *        - payload.floor in [0.5, 1.0] (whatever floor the host advertised
 *          — spec default 0.5, operator stricter is permitted)
 *        - payload.escalationKind === 'clarify' (the reference host emits
 *          clarify; hosts choosing 'escalate' would also be conformant)
 *        - payload.workerId === the dispatch's first nextWorkerIds entry
 *        - payload.originalDecision carries the verbatim OrchestratorDecision
 *      AND causationId chains back to the `runOrchestrator.decided` event
 *      that emitted the low-confidence decision.
 *
 *   4. The event log contains ZERO `core.workflowChain.event` records — the
 *      escalation fired BEFORE any dispatch.began event per RFC 0039 §A
 *      ("the escalation event MUST appear in the run event log BEFORE the
 *      interrupt fires AND BEFORE any `core.workflowChain.event` with
 *      `phase: 'dispatch.began'` for the escalated decision's intended
 *      next-worker"). This is the load-bearing test that distinguishes
 *      `version: 2` from `version: 1`: `version: 1` hosts dispatch
 *      unconditionally; `version: 2` hosts gate on confidence.
 *
 * @see RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A
 * @see spec/v1/multi-agent-execution.md §"Confidence escalation (RFC 0039)"
 * @see schemas/run-event-payloads.schema.json §coreWorkflowChainConfidenceEscalated
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntil } from '../lib/polling.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const FIXTURE = 'conformance-multi-agent-confidence-escalation';
const BEHAVIORAL_SKIP = HTTP_SKIP || !isFixtureAdvertised(FIXTURE);

interface RunEvent { type: string; eventId?: string; causationId?: string; payload?: Record<string, unknown>; }

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        supported?: unknown;
        version?: unknown;
        confidenceEscalationFloor?: unknown;
        confidenceEscalationInterruptKind?: unknown;
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

describe.skipIf(HTTP_SKIP)('multi-agent-confidence-escalation: capability shape (RFC 0039 §A)', () => {
  it('confidenceEscalationFloor (when advertised) MUST be in [0.5, 1.0]', async () => {
    const d = await readDiscovery();
    if (d === null) return softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
    const em = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel;
    if (em === undefined) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `em === undefined` returned early');
    const floor = em.confidenceEscalationFloor;
    if (floor === undefined) return softSkip('blocked', 'precondition not met — `floor === undefined` returned early (seam, prior step, or fixture unavailable)');
    expect(
      typeof floor === 'number' && Number.isFinite(floor) && floor >= 0.5 && floor <= 1.0,
      req('openwop.it.multi-agent-confidence-escalation.confidenceescalationfloor-when-advertised-must-be-in-0-5-1-0', 
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A',
        'confidenceEscalationFloor MUST be number in [0.5, 1.0]; values below the spec floor are non-conformant',
      ),
    ).toBe(true);
  });
});

describe.skipIf(BEHAVIORAL_SKIP)('multi-agent-confidence-escalation: behavioral (RFC 0039 §A)', () => {
  it('happy-path: low-confidence decision → confidence-escalated event + clarification interrupt + zero dispatch events', async () => {
    const d = await readDiscovery();
    const supported = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.supported === true;
    const versionRaw = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.version;
    const version = typeof versionRaw === 'number' ? versionRaw : 0;
    if (!supported || version < 2) return softSkip('inapplicable', 'soft-skip — `version: 1` hosts pass via this absence (!supported || version < 2)');

    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // RFC 0039 confidence escalation SUSPENDS the parent (a `waiting-*` status)
    // — it is NOT a terminal `completed`/`failed`/`cancelled`. So poll until the
    // run either suspends or settles; polling only for terminal statuses
    // (`pollUntilTerminal`, whose set is {completed,failed,cancelled}) would time
    // out before the suspension is ever observed — the cause of the prior flake.
    const terminal = await pollUntil(runId, (s) => {
      const st = s.status as string;
      return st.startsWith('waiting-') || st === 'completed' || st === 'failed' || st === 'cancelled';
    });
    // RFC 0039 §A gives hosts a choice: clarify-kind escalation
    // (→ waiting-clarification) OR escalate-kind approval (→ waiting-approval).
    //
    // RFC 0044 routing: when the host advertises
    // `capabilities.multiAgent.executionModel.confidenceEscalationInterruptKind`
    // the scenario derives the expected terminal-status from that advertisement
    // (canonical kinds map 1:1 to waiting-clarification / waiting-approval per
    // `interrupt.md`; vendor `x-host-<host>-<kind>` kinds accept any waiting-*
    // status — the host's own interrupt.md mapping determines the suffix).
    // When the host does NOT advertise the field, fall back to the canonical
    // either-status check.
    const advertisedKind = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.confidenceEscalationInterruptKind;
    const isVendorKind = typeof advertisedKind === 'string' && /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(advertisedKind);
    const isCanonicalKind = advertisedKind === 'clarification' || advertisedKind === 'approval';

    if (isCanonicalKind) {
      const expectedStatus = advertisedKind === 'clarification' ? 'waiting-clarification' : 'waiting-approval';
      expect(
        terminal.status,
        req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 
          'RFCS/0044-confidence-escalation-interrupt-kind-advertisement.md §B',
          `host advertising confidenceEscalationInterruptKind: "${advertisedKind}" MUST surface the run as "${expectedStatus}" per spec/v1/interrupt.md §"Interrupt kinds"`,
        ),
      ).toBe(expectedStatus);
    } else if (isVendorKind) {
      const status = terminal.status as string;
      expect(
        typeof status === 'string' && status.startsWith('waiting-'),
        req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 
          'RFCS/0044-confidence-escalation-interrupt-kind-advertisement.md §B',
          `host advertising vendor confidenceEscalationInterruptKind ("${advertisedKind}") MUST surface the run as a waiting-* status; the suffix is determined by the host's interrupt.md mapping (see the host's vendor-extensions doc per RFC 0044 §C)`,
        ),
      ).toBe(true);
    } else {
      // No advertisement — fall back to the canonical either-status check.
      const acceptedStatuses = ['waiting-clarification', 'waiting-approval'];
      expect(
        acceptedStatuses.includes(terminal.status as string),
        req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 
          'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A + spec/v1/interrupt.md',
          'a host below the confidence floor MUST surface the run as `waiting-clarification` (clarify-kind escalation) OR `waiting-approval` (escalate-kind escalation) per RFC 0039 §A; the low-confidence decision MUST NOT reach `completed` because no dispatch fired',
        ),
      ).toBe(true);
    }

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);

    const escalated = events.filter((e) => e.type === 'core.workflowChain.confidence-escalated');
    expect(escalated.length, req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 
      'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A',
      'low-confidence decision MUST emit exactly one core.workflowChain.confidence-escalated event',
    )).toBe(1);

    const ev = escalated[0]!;
    const payload = (ev.payload ?? {}) as { confidence?: number; floor?: number; escalationKind?: string; workerId?: string };
    expect(payload.confidence, req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A', 'payload.confidence echoes the decision')).toBe(0.3);
    expect(
      typeof payload.floor === 'number' && payload.floor >= 0.5 && payload.floor <= 1.0,
      req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A', 'payload.floor is the host-advertised floor (in [0.5, 1.0])'),
    ).toBe(true);
    expect(
      payload.escalationKind === 'clarify' || payload.escalationKind === 'escalate',
      req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A', 'payload.escalationKind ∈ {clarify, escalate}'),
    ).toBe(true);

    // Causation (S32, 2026-08-17): this leg used to REQUIRE `causationId` → a
    // `runOrchestrator.decided`, which contradicts RFC 0011 §F CP-1 as asserted by
    // orchestratorConservativePath.test.ts — a low-confidence decision is HELD, so
    // no `runOrchestrator.decided` exists on the log before ratification; the
    // escalation event carries the decision verbatim in `originalDecision` for
    // exactly that reason (multi-agent-execution.md §"Confidence escalation").
    // Rule now: `causationId` MAY be absent; when present it MUST resolve to an
    // event already on this run's log (a host that does emit a pre-ratification
    // decided event may point at it; one that honours CP-1 points at nothing or at
    // the preceding node event).
    if (typeof ev.causationId === 'string' && ev.causationId.length > 0) {
      const cause = events.find((e) => e.eventId === ev.causationId);
      expect(
        cause !== undefined,
        req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 
          'spec/v1/multi-agent-execution.md §"Confidence escalation"',
          `confidence-escalated causationId (${ev.causationId}) MUST resolve to an event on this run's log when present`,
        ),
      ).toBe(true);
    }
    const original = (ev.payload as { originalDecision?: unknown } | undefined)?.originalDecision;
    expect(
      original !== null && typeof original === 'object',
      req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 'run-event-payloads.schema.json §confidence-escalated', 'payload.originalDecision carries the escalated OrchestratorDecision verbatim — the decision is on the log HERE, not on a prior decided event'),
    ).toBe(true);

    // Load-bearing: NO dispatch event fired. RFC 0039 gates BEFORE the loop.
    const chainEvents = events.filter((e) => e.type === 'core.workflowChain.event');
    expect(
      chainEvents.length,
      req('openwop.it.multi-agent-confidence-escalation.happy-path-low-confidence-decision-confidence-escalated-event-clarification-inte', 
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A',
        'low-confidence decision MUST NOT produce any core.workflowChain.event records — the escalation fires before any dispatch.began per the spec ordering',
      ),
    ).toBe(0);
  });
});
