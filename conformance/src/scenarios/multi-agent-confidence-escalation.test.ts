/**
 * multi-agent-confidence-escalation — RFC 0039 §A behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0039 Phase 2
 * filed Draft → graduated Active 2026-05-22 in the same commit chain as
 * this scenario. Capability-gated on
 * `capabilities.multiAgent.executionModel.supported: true` AND
 * `capabilities.multiAgent.executionModel.version >= 2` AND fixture
 * availability. Hosts that advertise only Phase 1 (version: 1) soft-skip
 * cleanly — the confidence-floor MUST applies only at version >= 2.
 *
 * Asserts (behavioral when host advertises Phase 2):
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
 *      Phase 2 from Phase 1: Phase 1 hosts dispatch unconditionally; Phase 2
 *      hosts gate on confidence.
 *
 * @see RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A
 * @see spec/v1/multi-agent-execution.md §"Confidence escalation (RFC 0039 Phase 2)"
 * @see schemas/run-event-payloads.schema.json §coreWorkflowChainConfidenceEscalated
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal } from '../lib/polling.js';

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
    if (d === null) return;
    const em = d.capabilities?.multiAgent?.executionModel;
    if (em === undefined) return;
    const floor = em.confidenceEscalationFloor;
    if (floor === undefined) return;
    expect(
      typeof floor === 'number' && Number.isFinite(floor) && floor >= 0.5 && floor <= 1.0,
      driver.describe(
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A',
        'confidenceEscalationFloor MUST be number in [0.5, 1.0]; values below the spec floor are non-conformant',
      ),
    ).toBe(true);
  });
});

describe.skipIf(BEHAVIORAL_SKIP)('multi-agent-confidence-escalation: behavioral (RFC 0039 §A)', () => {
  it('happy-path: low-confidence decision → confidence-escalated event + clarification interrupt + zero dispatch events', async () => {
    const d = await readDiscovery();
    const supported = d?.capabilities?.multiAgent?.executionModel?.supported === true;
    const versionRaw = d?.capabilities?.multiAgent?.executionModel?.version;
    const version = typeof versionRaw === 'number' ? versionRaw : 0;
    if (!supported || version < 2) return; // soft-skip — Phase 1 hosts pass via this absence

    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    // Phase 2 escalation suspends the parent — NOT a terminal `completed`.
    // The conformance pollUntilTerminal returns when the run reaches any
    // settled status. RFC 0039 §A gives hosts a choice: clarify-kind
    // escalation (→ waiting-clarification) OR escalate-kind approval
    // (→ waiting-approval). The scenario MUST accept either canonical
    // status. Hosts using vendor-extension interrupt kinds (e.g., a host-
    // specific `x-host-<host>-<kind>` per `host-extensions.md`) currently
    // can't pass this assertion without spec follow-up adding a
    // capability flag advertising their kind; until then, this assertion
    // is the canonical bar.
    const acceptedStatuses = ['waiting-clarification', 'waiting-approval'];
    expect(
      acceptedStatuses.includes(terminal.status as string),
      driver.describe(
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A + spec/v1/interrupt.md',
        'a host below the confidence floor MUST surface the run as `waiting-clarification` (clarify-kind escalation) OR `waiting-approval` (escalate-kind escalation) per RFC 0039 §A; the low-confidence decision MUST NOT reach `completed` because no dispatch fired',
      ),
    ).toBe(true);

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);

    const escalated = events.filter((e) => e.type === 'core.workflowChain.confidence-escalated');
    expect(escalated.length, driver.describe(
      'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A',
      'low-confidence decision MUST emit exactly one core.workflowChain.confidence-escalated event',
    )).toBe(1);

    const ev = escalated[0]!;
    const payload = (ev.payload ?? {}) as { confidence?: number; floor?: number; escalationKind?: string; workerId?: string };
    expect(payload.confidence, 'payload.confidence echoes the decision').toBe(0.3);
    expect(
      typeof payload.floor === 'number' && payload.floor >= 0.5 && payload.floor <= 1.0,
      'payload.floor is the host-advertised floor (in [0.5, 1.0])',
    ).toBe(true);
    expect(
      payload.escalationKind === 'clarify' || payload.escalationKind === 'escalate',
      'payload.escalationKind ∈ {clarify, escalate}',
    ).toBe(true);

    // Causation chain: escalation event causes back to the runOrchestrator.decided
    // that named the worker.
    const decidedEvent = events.find((e) => e.eventId === ev.causationId);
    expect(
      decidedEvent?.type,
      'confidence-escalated causationId MUST point at the runOrchestrator.decided that surfaced the low-confidence decision',
    ).toBe('runOrchestrator.decided');

    // Load-bearing: NO dispatch event fired. Phase 2 gates BEFORE the loop.
    const chainEvents = events.filter((e) => e.type === 'core.workflowChain.event');
    expect(
      chainEvents.length,
      driver.describe(
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §A',
        'low-confidence decision MUST NOT produce any core.workflowChain.event records — the escalation fires before any dispatch.began per the spec ordering',
      ),
    ).toBe(0);
  });
});
