/**
 * Project an `EnvelopeOutcome` onto spec-prescribed RunEventDocs.
 *
 * Per RFC 0021 §A point 1-7 + `ai-envelope.md §"Universal kinds"` +
 * `interrupt.md` + `capabilities.md §"Engine-enforced limits"`, the
 * engine MUST project each acceptor outcome onto the run event log:
 *
 *   accepted + clarification.request → interrupt.requested (kind: 'clarification')
 *   accepted + schema.request        → log.appended (level: 'info', kind tracking)
 *   accepted + schema.response       → log.appended (level: 'info', counted/exempt)
 *   accepted + error                 → log.appended (level: 'error') — NOT node.failed
 *   accepted + vendor.*              → log.appended (level: 'info', kind tracking)
 *   invalid                          → node.failed (envelope_validation_failed)
 *   gated (fail-node)                → node.failed (envelope_contract_violation
 *                                                    + details.refusedType
 *                                                    + details.acceptedTypes[])
 *   gated (discard-and-warn)         → log.appended (level: 'warn')
 *   breached                         → cap.breached + node.failed
 *
 * Every projected event carries:
 *   - causationId = envelope.correlationId per RFC 0021 §"Replay determinism"
 *   - contentTrust = normalizedMeta.contentTrust per RFC 0021 §A point 6
 *
 * The pure acceptor stays unchanged; this module operates on its outcome.
 */

import type { EnvelopeOutcome } from './envelopeAcceptor.js';
import { appendTestEvent, type TestRunEvent } from './envelopeEventLog.js';
import { appendTestSpan } from '../observability/spanBuffer.js';

export interface ProjectOpts {
  /** Run id to scope the projection. Test-only — production hosts use
   *  the run's real id. */
  runId: string;
  /** Per-envelope correlationId. Used as causationId on every projected
   *  event per RFC 0021 §"Replay determinism". */
  correlationId: string;
  /** Envelope's `type` field (e.g. 'clarification.request'). */
  envelopeType: string;
  /** Envelope's `schemaVersion` for OTel drift attribute projection. */
  envelopeSchemaVersion?: number;
  /** Optional node id the projection associates the events with. */
  nodeId?: string;
  /** Refusal mode per RFC 0021's Envelope Contract section. Defaults
   *  to 'fail-node' for `gated` outcomes. */
  refusalMode?: 'fail-node' | 'discard-and-warn';
  /** Schema-version drift context — when an `accepted` outcome happened
   *  via the schemaVersionFloor + envelopeStrictness='warn' path
   *  (below-floor schemaVersion accepted with warning), project an
   *  OTel span attribute `envelope_schema_version_drift = true` per
   *  `ai-envelope.md §"Schema discipline"`. */
  driftFloor?: number;
}

export function projectOutcome(outcome: EnvelopeOutcome, opts: ProjectOpts): TestRunEvent[] {
  const projected: TestRunEvent[] = [];
  const { runId, correlationId, envelopeType, envelopeSchemaVersion, nodeId, refusalMode = 'fail-node', driftFloor } = opts;
  const causationId = correlationId;

  // Emit an OTel `envelope_*` span for every projected outcome. Per
  // `observability.md` §"AI cost" + RFC 0021 §"Schema discipline":
  //   - span name = `envelope.${status}`
  //   - attributes never include payload contents (the projection here
  //     persists ONLY the categorized outcome shape, so canary plaintext
  //     never reaches the span — satisfies the SR-1 carry-forward
  //     invariant for OTel).
  //   - schema-drift attribute when below-floor + warn-strictness was
  //     used (driftFloor is supplied by the caller in that path).
  const spanAttrs: Record<string, string | number | boolean> = {
    envelope_type: envelopeType,
    envelope_outcome: outcome.status,
    envelope_correlation_id: correlationId,
  };
  if (typeof envelopeSchemaVersion === 'number') {
    spanAttrs.envelope_schema_version = envelopeSchemaVersion;
  }
  if (
    outcome.status === 'accepted' &&
    typeof driftFloor === 'number' &&
    typeof envelopeSchemaVersion === 'number' &&
    envelopeSchemaVersion !== driftFloor
  ) {
    spanAttrs.envelope_schema_version_drift = true;
    spanAttrs.envelope_schema_version_floor = driftFloor;
  }
  if (outcome.status === 'accepted') {
    spanAttrs.envelope_content_trust = outcome.normalizedMeta.contentTrust;
    if (typeof outcome.envelopeId === 'string') spanAttrs.envelope_id = outcome.envelopeId;
  }
  appendTestSpan({
    name: `envelope.${outcome.status}`,
    attributes: spanAttrs,
    runId,
    ...(outcome.status === 'accepted' && typeof outcome.envelopeId === 'string' ? { envelopeId: outcome.envelopeId } : {}),
  });

  if (outcome.status === 'accepted') {
    const contentTrust = outcome.normalizedMeta.contentTrust;
    if (envelopeType === 'clarification.request') {
      // RFC 0021 §A: lift to kind: 'clarification' interrupt per interrupt.md
      projected.push(
        appendTestEvent({
          runId,
          type: 'interrupt.requested',
          payload: {
            kind: 'clarification',
            envelopeId: outcome.envelopeId,
            // Resume schema would be lifted from the payload's `responseSchema` per ai-envelope.md
          },
          causationId,
          ...(nodeId !== undefined ? { nodeId } : {}),
          contentTrust,
        }),
      );
    } else if (envelopeType === 'error') {
      // RFC 0021 §"Universal kinds": LLM-emitted error envelope projects to log.appended (level: 'error')
      // — NOT node.failed (which is for terminal node failure).
      projected.push(
        appendTestEvent({
          runId,
          type: 'log.appended',
          payload: {
            level: 'error',
            message: 'LLM emitted error envelope',
            fields: { envelopeId: outcome.envelopeId, envelopeType },
          },
          causationId,
          ...(nodeId !== undefined ? { nodeId } : {}),
          contentTrust,
        }),
      );
    } else if (envelopeType === 'schema.request' || envelopeType === 'schema.response') {
      // RFC 0021 §"Universal kinds": schema.* envelopes project to log.appended at info level
      // (the schema delivery happens out-of-band via the next-turn system prompt).
      projected.push(
        appendTestEvent({
          runId,
          type: 'log.appended',
          payload: {
            level: 'info',
            message: `LLM emitted ${envelopeType}`,
            fields: { envelopeId: outcome.envelopeId, envelopeType },
          },
          causationId,
          ...(nodeId !== undefined ? { nodeId } : {}),
          contentTrust,
        }),
      );
    } else {
      // Vendor-namespaced kinds: emit a tracking log.appended.
      projected.push(
        appendTestEvent({
          runId,
          type: 'log.appended',
          payload: {
            level: 'info',
            message: `LLM emitted ${envelopeType}`,
            fields: { envelopeId: outcome.envelopeId, envelopeType },
          },
          causationId,
          ...(nodeId !== undefined ? { nodeId } : {}),
          contentTrust,
        }),
      );
    }
  } else if (outcome.status === 'invalid') {
    projected.push(
      appendTestEvent({
        runId,
        type: 'node.failed',
        payload: {
          nodeId: nodeId ?? 'unknown',
          error: {
            code: 'envelope_validation_failed',
            message: outcome.reason,
            details: { violations: outcome.details },
          },
        },
        causationId,
        ...(nodeId !== undefined ? { nodeId } : {}),
      }),
    );
  } else if (outcome.status === 'gated') {
    if (refusalMode === 'discard-and-warn') {
      projected.push(
        appendTestEvent({
          runId,
          type: 'log.appended',
          payload: {
            level: 'warn',
            message: outcome.reason,
            fields: {
              envelopeType,
              allowedKinds: outcome.allowedKinds,
              refusalMode: 'discard-and-warn',
            },
          },
          causationId,
          ...(nodeId !== undefined ? { nodeId } : {}),
        }),
      );
    } else {
      projected.push(
        appendTestEvent({
          runId,
          type: 'node.failed',
          payload: {
            nodeId: nodeId ?? 'unknown',
            error: {
              code: 'envelope_contract_violation',
              message: outcome.reason,
              details: {
                refusedType: envelopeType,
                acceptedTypes: outcome.allowedKinds,
              },
            },
          },
          causationId,
          ...(nodeId !== undefined ? { nodeId } : {}),
        }),
      );
    }
  } else if (outcome.status === 'breached') {
    // RFC 0021 §"Engine-enforced limits" + capabilities.md §"cap.breached":
    // emit cap.breached + terminal node.failed.
    projected.push(
      appendTestEvent({
        runId,
        type: 'cap.breached',
        payload: {
          kind: outcome.capKind,
          // The acceptor doesn't know the limit + observed values directly;
          // the test seam threads them via the cap counters. Reason carries
          // both for now; production hosts emit explicit numeric fields.
          limit: extractCapNumeric(outcome.reason, 'cap'),
          observed: extractCapNumeric(outcome.reason, 'current') ?? extractCapNumeric(outcome.reason, 'observed'),
          ...(nodeId !== undefined ? { nodeId } : {}),
        },
        causationId,
        ...(nodeId !== undefined ? { nodeId } : {}),
      }),
    );
    projected.push(
      appendTestEvent({
        runId,
        type: 'node.failed',
        payload: {
          nodeId: nodeId ?? 'unknown',
          error: {
            code: 'cap_breached',
            message: outcome.reason,
            details: { capKind: outcome.capKind },
          },
        },
        causationId,
        ...(nodeId !== undefined ? { nodeId } : {}),
      }),
    );
  }

  return projected;
}

/** Best-effort number extraction from the acceptor's reason string,
 *  e.g. "envelopesPerTurn cap (32) breached" → 32 for key='cap'. */
function extractCapNumeric(reason: string, _key: string): number | undefined {
  const m = reason.match(/\((\d+)\)/);
  return m ? Number(m[1]) : undefined;
}
