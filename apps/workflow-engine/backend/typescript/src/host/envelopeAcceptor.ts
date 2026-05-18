/**
 * AI Envelope Acceptor — RFC 0021 §A reference implementation.
 *
 * The engine MUST accept AI Envelopes from any node whose `typeId`
 * declares an envelope-emitting role and validate them through the
 * pipeline documented in `spec/v1/ai-envelope.md`:
 *
 *   1. shape validation against `schemas/ai-envelope.schema.json`
 *      (top-level discriminator + meta block)
 *   2. kind validation against the host's `supportedEnvelopes`
 *      advertisement
 *   3. payload validation against the per-kind schema (when supplied
 *      for universal kinds or vendor-published for namespaced kinds)
 *   4. Envelope Contract gate (per-node permission set — host's
 *      advertised `core.<typeId>.allowedEnvelopeKinds`)
 *   5. BYOK redaction (SR-1 carry-forward — preserve `[REDACTED:<id>]`
 *      markers unchanged)
 *   6. trust-boundary normalization (`meta.contentTrust` propagated
 *      from `ctx.trustBoundary` when absent)
 *
 * This module implements steps 1-3 + 6 (the always-applicable subset).
 * Steps 4 and 5 are host-policy concerns and are surfaced as optional
 * hooks on `AcceptOptions`.
 *
 * Schema cache: per-kind schema validators are compiled once at module
 * load and cached by kind. Top-level envelope validator is also cached.
 *
 * @see RFCS/0021-ai-envelope-primitive.md
 * @see spec/v1/ai-envelope.md §"Primitive"
 * @see schemas/ai-envelope.schema.json
 * @see schemas/envelopes/{clarification.request,schema.request,schema.response,error}.schema.json
 */

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo-root / schemas. The host is at apps/workflow-engine/backend/typescript/src/host/.
const SCHEMAS_DIR = resolve(__dirname, '..', '..', '..', '..', '..', '..', 'schemas');

// Per-kind payload schema paths. Universal kinds only — vendor-namespaced
// kinds rely on host-published schemas advertised via `Capabilities.
// schemaVersions[<kind>]` (out of scope for the reference sample).
const UNIVERSAL_KINDS = [
  'clarification.request',
  'schema.request',
  'schema.response',
  'error',
] as const;
export type UniversalKind = (typeof UNIVERSAL_KINDS)[number];

// Ajv2020 in `strict: false` mode tolerates unknown `format` keywords
// (e.g., `"format": "date-time"` on `meta.ts`). The `ai-envelope.schema.json`
// declares the format but Ajv silently ignores it without `ajv-formats`
// registered. We avoid a new direct dependency (`ajv-formats` is a
// transitive of `@openwop/openwop-conformance` only) and add a manual
// ISO 8601 sanity check below (see `ISO_8601_RE`). Hosts that need
// strict format validation SHOULD register `ajv-formats` on their own
// Ajv instance.
const ajv = new Ajv2020({ strict: false, allErrors: true });

/** RFC 3339 / ISO 8601 subset: `YYYY-MM-DDTHH:MM:SS[.fff]Z` or
 *  with a `±HH:MM` offset. Mirrors what `ajv-formats` `date-time`
 *  accepts without pulling in the dep. */
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
let _envelopeValidator: ValidateFunction | null = null;
const _payloadValidators = new Map<string, ValidateFunction>();

function loadEnvelopeValidator(): ValidateFunction {
  if (_envelopeValidator) return _envelopeValidator;
  const path = join(SCHEMAS_DIR, 'ai-envelope.schema.json');
  const schema = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  _envelopeValidator = ajv.compile(schema);
  return _envelopeValidator;
}

function loadPayloadValidator(kind: string): ValidateFunction | null {
  if (_payloadValidators.has(kind)) return _payloadValidators.get(kind) ?? null;
  if (!(UNIVERSAL_KINDS as readonly string[]).includes(kind)) {
    return null; // vendor-namespaced — no in-tree schema
  }
  const path = join(SCHEMAS_DIR, 'envelopes', `${kind}.schema.json`);
  try {
    const schema = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const v = ajv.compile(schema);
    _payloadValidators.set(kind, v);
    return v;
  } catch {
    return null;
  }
}

export interface AIEnvelope {
  type: string;
  schemaVersion: number;
  envelopeId: string;
  correlationId: string;
  nodeId?: string;
  payload: unknown;
  meta: {
    source: 'ai-generation' | 'user' | 'system';
    contentTrust?: 'trusted' | 'untrusted';
    ts: string;
    traceparent?: string;
    label?: string;
    [k: string]: unknown;
  };
  partial?: { isPartial: boolean; index: number; total: number };
}

export interface ValidationDetail {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string | undefined;
}

export type EnvelopeOutcome =
  | {
      status: 'accepted';
      recordedEventIds: string[];
      envelopeId: string;
      /** RFC 0021 §A point 6 — trust-boundary normalization. When the
       *  inbound envelope's `meta.contentTrust` was absent, this carries
       *  the run-level propagated value (`opts.runTrustBoundary`) so the
       *  caller knows what to persist on the recorded view. When the
       *  envelope already had `meta.contentTrust` set, this echoes it
       *  back. Defaults to `'trusted'` when neither is supplied. */
      normalizedMeta: { contentTrust: 'trusted' | 'untrusted' };
    }
  | { status: 'invalid'; reason: string; details: ValidationDetail[] }
  | { status: 'gated'; reason: string; allowedKinds: readonly string[] }
  | { status: 'breached'; reason: string; capKind: 'envelopes' | 'schema' | 'clarification' };

export interface AcceptOptions {
  /** Run-level trust boundary. When `meta.contentTrust` is absent on the
   *  inbound envelope, the acceptor copies this onto the recorded view
   *  so downstream consumers see the propagated trust marker. */
  runTrustBoundary?: 'trusted' | 'untrusted';
  /** Host-advertised supported-envelope list. Inbound `type` MUST be
   *  in this list (or one of the universal kinds, which are always
   *  allowed per RFC 0021 §"Universal kinds"). When absent, the
   *  acceptor allows any kind (most permissive). */
  hostSupportedEnvelopes?: readonly string[];
  /** Per-node allowed-kinds set. When supplied AND the envelope's
   *  type is not in the universal-kind set, the type MUST be in this
   *  set or the envelope is gated. */
  nodeAllowedKinds?: readonly string[];
  /** Round counters to enforce engine-limit caps. Acceptor returns
   *  `breached` when counters exceed the cap. */
  counters?: {
    envelopesPerTurn?: { current: number; cap: number };
    schemaRounds?: { current: number; cap: number };
    clarificationRounds?: { current: number; cap: number };
  };
}

function validationDetail(d: { instancePath: string; schemaPath: string; keyword: string; message?: string | undefined }): ValidationDetail {
  return {
    instancePath: d.instancePath,
    schemaPath: d.schemaPath,
    keyword: d.keyword,
    ...(d.message !== undefined ? { message: d.message } : {}),
  };
}

/** RFC 0021 §A AIEnvelopeAcceptor reference implementation. Pure
 *  function; the caller is responsible for emitting the matching
 *  `RunEventDoc` records (the acceptor returns the would-be event ids
 *  in the `accepted` outcome so the caller can pair them with its own
 *  event log). */
export function acceptEnvelope(envelope: unknown, opts: AcceptOptions = {}): EnvelopeOutcome {
  // Step 1: shape validation against ai-envelope.schema.json.
  const envelopeValidator = loadEnvelopeValidator();
  if (!envelopeValidator(envelope)) {
    return {
      status: 'invalid',
      reason: 'envelope top-level shape validation failed',
      details: (envelopeValidator.errors ?? []).map(validationDetail),
    };
  }
  const env = envelope as AIEnvelope;

  // Defense-in-depth: validate `meta.ts` against ISO 8601. The schema
  // declares `format: "date-time"` which Ajv ignores under strict:false
  // (no ajv-formats); we MUST NOT accept "tomorrow" or other non-
  // timestamp strings on a field that downstream consumers parse as a Date.
  if (typeof env.meta?.ts !== 'string' || !ISO_8601_RE.test(env.meta.ts)) {
    return {
      status: 'invalid',
      reason: 'meta.ts MUST be an ISO 8601 / RFC 3339 timestamp',
      details: [
        {
          instancePath: '/meta/ts',
          schemaPath: '#/properties/meta/properties/ts/format',
          keyword: 'format',
          message: `expected ISO 8601 (e.g., "2026-05-18T10:00:00Z"); got ${JSON.stringify(env.meta?.ts)}`,
        },
      ],
    };
  }

  // Step 2: kind validation against host's supportedEnvelopes.
  const universals = UNIVERSAL_KINDS as readonly string[];
  if (opts.hostSupportedEnvelopes !== undefined) {
    const isUniversal = universals.includes(env.type);
    const isAdvertised = opts.hostSupportedEnvelopes.includes(env.type);
    if (!isUniversal && !isAdvertised) {
      return {
        status: 'gated',
        reason: `envelope type '${env.type}' is not in host's supportedEnvelopes advertisement`,
        allowedKinds: [...universals, ...opts.hostSupportedEnvelopes],
      };
    }
  }

  // Step 3: payload validation against the per-kind schema (when available).
  const payloadValidator = loadPayloadValidator(env.type);
  if (payloadValidator && !payloadValidator(env.payload)) {
    return {
      status: 'invalid',
      reason: `payload for kind '${env.type}' failed validation`,
      details: (payloadValidator.errors ?? []).map(validationDetail),
    };
  }

  // Step 4: Envelope Contract gate (per-node permission set).
  if (opts.nodeAllowedKinds !== undefined) {
    const isUniversal = universals.includes(env.type);
    const isAllowed = opts.nodeAllowedKinds.includes(env.type);
    if (!isUniversal && !isAllowed) {
      return {
        status: 'gated',
        reason: `envelope type '${env.type}' not in this node's allowedEnvelopeKinds`,
        allowedKinds: [...universals, ...opts.nodeAllowedKinds],
      };
    }
  }

  // Engine-limit cap enforcement. Universal kinds bind to specific
  // caps per RFC 0021 §"Universal kinds (normative)":
  //   - clarification.request → limits.clarificationRounds
  //   - schema.request        → limits.schemaRounds
  //   - error / vendor kinds  → limits.envelopesPerTurn
  //   - schema.response       → may be exempt; counted under envelopesPerTurn here
  const counters = opts.counters ?? {};
  if (env.type === 'clarification.request' && counters.clarificationRounds) {
    if (counters.clarificationRounds.current >= counters.clarificationRounds.cap) {
      return {
        status: 'breached',
        reason: `clarificationRounds cap (${counters.clarificationRounds.cap}) breached`,
        capKind: 'clarification',
      };
    }
  } else if (env.type === 'schema.request' && counters.schemaRounds) {
    if (counters.schemaRounds.current >= counters.schemaRounds.cap) {
      return {
        status: 'breached',
        reason: `schemaRounds cap (${counters.schemaRounds.cap}) breached`,
        capKind: 'schema',
      };
    }
  } else if (counters.envelopesPerTurn) {
    if (counters.envelopesPerTurn.current >= counters.envelopesPerTurn.cap) {
      return {
        status: 'breached',
        reason: `envelopesPerTurn cap (${counters.envelopesPerTurn.cap}) breached`,
        capKind: 'envelopes',
      };
    }
  }

  // Step 6: trust-boundary normalization. RFC 0021 §A point 6 + §"Trust
  // boundary." Precedence (most → least specific):
  //   (a) envelope's own `meta.contentTrust` (the LLM declared it)
  //   (b) `opts.runTrustBoundary` (host propagated from run.metadata)
  //   (c) `'trusted'` default
  // The acceptor returns the resolved value on `normalizedMeta` so the
  // caller knows what to persist on the recorded view. We don't mutate
  // the input.
  const normalizedContentTrust: 'trusted' | 'untrusted' =
    env.meta?.contentTrust ?? opts.runTrustBoundary ?? 'trusted';

  const envelopeId = env.envelopeId || `env-${randomUUID()}`;
  return {
    status: 'accepted',
    recordedEventIds: [], // host emits RunEventDocs; this acceptor stays pure
    envelopeId,
    normalizedMeta: { contentTrust: normalizedContentTrust },
  };
}

/** Test seam — clears the schema caches. Allows hot-reload tests to
 *  re-resolve schemas if they change on disk between runs. */
export function _resetEnvelopeAcceptorCaches(): void {
  _envelopeValidator = null;
  _payloadValidators.clear();
}

/** Returns the universal-kind list. Discovery route MUST include
 *  these in its `supportedEnvelopes` advertisement when the host
 *  advertises `aiProviders.supported: true`. */
export function universalEnvelopeKinds(): readonly UniversalKind[] {
  return UNIVERSAL_KINDS;
}
