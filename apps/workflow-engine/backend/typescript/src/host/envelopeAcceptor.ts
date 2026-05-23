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
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeEnvelopePayload } from './envelopeNormalizers.js';
import { locateRepoSchemasDir } from './_repoPath.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Locate the repo `schemas/` directory under both source-tree and
// esbuild-bundled layouts. See `_repoPath.ts` for the implementation;
// the sentinel here is the schema this acceptor loads first.
const SCHEMAS_DIR = locateRepoSchemasDir(__dirname, 'ai-envelope.schema.json');

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
      /** RFC 0021 §"Redaction (SR-1 carry-forward)" — when `opts.byokCanaries`
       *  is non-empty, the acceptor walks `envelope.payload` (recursively)
       *  and substitutes each canary substring with `[REDACTED:byok-canary]`.
       *  The result is published here as the host's authoritative
       *  recorded view; callers MUST persist `redactedPayload` (NOT the
       *  inbound `envelope.payload`) on event-log / OTel / debug-bundle /
       *  error-envelope surfaces. Absent when no canaries were supplied
       *  OR no substitutions occurred. */
      redactedPayload?: unknown;
      /** Number of canary substitutions applied across `redactedPayload`. */
      redactionCount?: number;
      /** Pre-validation coercions applied by the normalizer registry
       *  (see `host/envelopeNormalizers.ts`). Empty when nothing was
       *  coerced. Callers MAY surface these to OTel / debug bundles
       *  but MUST NOT use them to reject the envelope — the acceptor
       *  has already decided `accepted` and the warnings are advisory. */
      normalizerWarnings?: Array<{ field: string; reason: string; originalShape: string }>;
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
  /** RFC 0021 §"Schema discipline" — per-kind advertised floor versions.
   *  When supplied AND the envelope's `schemaVersion` diverges from the
   *  floor, the acceptor consults `envelopeStrictness` to decide whether
   *  to refuse. Below-floor under `'strict'` and ANY above-floor refuses
   *  with `unknown_schema_version`. Below-floor under `'warn'` (default)
   *  accepts silently — the engine projects the drift to `log.appended`
   *  separately. */
  schemaVersionFloor?: Readonly<Record<string, number>>;
  /** RFC 0021 §"Capability handshake integration" §`envelopeStrictness`. */
  envelopeStrictness?: 'warn' | 'strict';
  /** RFC 0021 §"Replay determinism" — prior `correlationId → outcome` map
   *  for in-process dedup. When the inbound envelope's `correlationId`
   *  is already in this map, the acceptor short-circuits and returns the
   *  cached outcome (handler MUST run at most once per correlationId per
   *  run lifetime). If the cached entry's `envelopeType` differs from
   *  the inbound `type`, refuse with `envelope_correlation_conflict`. */
  priorCorrelations?: ReadonlyMap<string, { outcome: EnvelopeOutcome; envelopeType: string }>;
  /** RFC 0021 §"Redaction (SR-1 carry-forward)" + `agent-memory.md` §SR-1 —
   *  canaries to scrub from the recorded view BEFORE persistence. Each
   *  entry pairs the secret's plaintext `value` with the `secretId` that
   *  identifies it in the host's BYOK vault. The acceptor substitutes
   *  every occurrence of `value` with the canonical SR-1 marker
   *  `[REDACTED:<secretId>]` (per `agent-memory.md:66`) in the
   *  `redactedPayload` of the accepted outcome. The LLM CAN hallucinate
   *  secret-shaped substrings from prompt context, so the host MUST scrub
   *  regardless of whether the model "promised" not to emit them. Empty
   *  array or undefined → no scrub pass. */
  byokCanaries?: ReadonlyArray<{ readonly value: string; readonly secretId: string }>;
  /** RFC 0021 §"Trust boundary" — approval-gate refusal context. When
   *  `true`, the acceptor evaluates the post-normalization
   *  `contentTrust` and refuses with `untrusted_content_blocks_approval`
   *  if the value is `'untrusted'`. Approval gates MUST NOT advance on
   *  envelopes whose content originated from an untrusted source
   *  (MCP tool result, A2A inbound, etc.) per `ai-envelope.md §"Trust
   *  boundary"` + `SECURITY/threat-model-prompt-injection.md`. The bit
   *  is a per-call decision because the same envelope can be valid in
   *  a non-approval context (e.g., observation, log) and refused in
   *  the approval-gate context. Acceptor stays pure — the caller marks
   *  the call as an approval-gate resolution; the acceptor enforces the
   *  refusal contract. */
  approvalGateContext?: boolean;
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

  // Step 1b: dedup via `correlationId` (RFC 0021 §"Replay determinism").
  // The handler MUST run at most once per `correlationId` per run
  // lifetime. A re-emission with the same correlationId and same type
  // returns the cached outcome; same correlationId + different type
  // refuses with `envelope_correlation_conflict`.
  if (opts.priorCorrelations && typeof env.correlationId === 'string') {
    const prior = opts.priorCorrelations.get(env.correlationId);
    if (prior) {
      if (prior.envelopeType !== env.type) {
        return {
          status: 'invalid',
          reason: 'envelope_correlation_conflict',
          details: [
            {
              instancePath: '/correlationId',
              schemaPath: '#/properties/correlationId',
              keyword: 'dedup',
              message: `correlationId '${env.correlationId}' previously bound to type '${prior.envelopeType}', re-emission with type '${env.type}' refused`,
            },
          ],
        };
      }
      return prior.outcome;
    }
  }

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

  // Step 2.5: pre-validation normalization. Coerce common AI shape
  // drift (string→array, singular→plural field renames, primitive→
  // wrapper-object) BEFORE running the per-kind validator. Warnings
  // are advisory only — they surface on the accepted outcome but
  // never block. See `host/envelopeNormalizers.ts` for the registry.
  const normalizeOutcome = normalizeEnvelopePayload(env.type, env.payload);
  const payloadForValidation = normalizeOutcome.payload;
  const normalizerWarnings = normalizeOutcome.warnings;

  // Step 3: payload validation against the per-kind schema (when available).
  const payloadValidator = loadPayloadValidator(env.type);
  if (payloadValidator && !payloadValidator(payloadForValidation)) {
    return {
      status: 'invalid',
      reason: `payload for kind '${env.type}' failed validation`,
      details: (payloadValidator.errors ?? []).map(validationDetail),
    };
  }

  // Step 3b: schema-version drift (RFC 0021 §"Schema discipline").
  // When the host advertises a per-kind floor version AND the inbound
  // `schemaVersion` diverges:
  //   - ABOVE floor → refuse `unknown_schema_version` (host doesn't know
  //     the higher version yet) regardless of strictness.
  //   - BELOW floor under `strict` → refuse `unknown_schema_version`.
  //   - BELOW floor under `warn` (default) → accept silently; engine
  //     projects the drift to `log.appended` at a higher layer.
  if (opts.schemaVersionFloor && typeof env.schemaVersion === 'number') {
    const floor = opts.schemaVersionFloor[env.type];
    if (typeof floor === 'number' && env.schemaVersion !== floor) {
      const strictness = opts.envelopeStrictness ?? 'warn';
      const drift = env.schemaVersion > floor ? 'above' : 'below';
      if (drift === 'above' || strictness === 'strict') {
        return {
          status: 'invalid',
          reason: `unknown_schema_version: kind '${env.type}' advertises floor v${floor}, got v${env.schemaVersion} (drift=${drift}, strictness=${strictness})`,
          details: [
            {
              instancePath: '/schemaVersion',
              schemaPath: '#/properties/schemaVersion',
              keyword: 'schemaVersionFloor',
              message: `expected v${floor} for type '${env.type}', got v${env.schemaVersion}`,
            },
          ],
        };
      }
      // 'warn' + below-floor: fall through to accept; the engine emits
      // `envelope_schema_version_drift` on the OTel span at the projection layer.
    }
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

  // Step 6b: approval-gate refusal. RFC 0021 §"Trust boundary" — when
  // the envelope is being presented as the resolution to an approval
  // gate AND the normalized contentTrust is `'untrusted'`, the gate
  // MUST refuse with `untrusted_content_blocks_approval`. The caller
  // marks the call as an approval-gate resolution via
  // `opts.approvalGateContext: true`; the acceptor enforces. Same
  // envelope can be valid in a non-approval context (observation,
  // log) — the bit is per-call.
  if (opts.approvalGateContext === true && normalizedContentTrust === 'untrusted') {
    return {
      status: 'invalid',
      reason: 'untrusted_content_blocks_approval',
      details: [
        {
          instancePath: '/meta/contentTrust',
          schemaPath: '#/properties/meta/properties/contentTrust',
          keyword: 'trust-boundary',
          message:
            'approval gate refuses untrusted envelope per ai-envelope.md §"Trust boundary": ' +
            'an envelope whose content originated from an untrusted source (MCP tool result, ' +
            'A2A inbound, etc.) MUST NOT advance an approval gate. Resubmit a trusted ' +
            'approval response or refuse the approval flow explicitly.',
        },
      ],
    };
  }

  const envelopeId = env.envelopeId || `env-${randomUUID()}`;

  // Step 7: BYOK canary redaction (RFC 0021 §"Redaction (SR-1 carry-
  // forward)" + `agent-memory.md` §SR-1). Runs AFTER validation + gates
  // + counters so the redaction pass operates only on payloads that
  // would otherwise be accepted. Each canary's `value` is replaced with
  // the canonical SR-1 marker `[REDACTED:<secretId>]` per
  // `agent-memory.md:66`. Deep + idempotent — payloads that already
  // contain `[REDACTED:...]` markers are unaffected.
  if (opts.byokCanaries && opts.byokCanaries.length > 0) {
    // Redact against the NORMALIZED payload (`payloadForValidation`),
    // not the original `env.payload`. The recorded view MUST match
    // the shape the validator approved — otherwise a replay-fork on
    // an envelope whose original payload was non-canonical would
    // re-run validation against the un-normalized shape and reject.
    // Original drift (if any) is retrievable via `normalizerWarnings[]`
    // for forensics. See envelopeNormalizers.ts.
    const redaction = redactCanaries(payloadForValidation, opts.byokCanaries);
    // When canaries were supplied, ALWAYS report the redaction count —
    // even when it's 0 — so callers can distinguish "walked, found
    // none" (count: 0) from "no canaries supplied" (field absent). The
    // `redactedPayload` is omitted on count: 0 because it equals the
    // input payload; callers should fall back to the inbound shape.
    return {
      status: 'accepted',
      recordedEventIds: [],
      envelopeId,
      normalizedMeta: { contentTrust: normalizedContentTrust },
      redactionCount: redaction.count,
      ...(redaction.count > 0
        ? { redactedPayload: redaction.value }
        : { redactedPayload: payloadForValidation }),
      ...(normalizerWarnings.length > 0 ? { normalizerWarnings } : {}),
    };
  }

  return {
    status: 'accepted',
    recordedEventIds: [], // host emits RunEventDocs; this acceptor stays pure
    envelopeId,
    normalizedMeta: { contentTrust: normalizedContentTrust },
    ...(normalizerWarnings.length > 0 ? { normalizerWarnings } : {}),
  };
}

/** Recursive canary substitution. Walks strings/arrays/objects and
 *  replaces each canary's `value` with the canonical SR-1 marker
 *  `[REDACTED:<secretId>]` per `agent-memory.md:66`. Returns the
 *  rebuilt value (input is not mutated) plus the total count of
 *  substitutions performed across all canaries.
 *
 *  Non-string scalar values (number, boolean, null) pass through
 *  unchanged. Cycle-safe by tracking visited objects. */
function redactCanaries(
  input: unknown,
  canaries: ReadonlyArray<{ readonly value: string; readonly secretId: string }>,
): { value: unknown; count: number } {
  let total = 0;
  const seen = new WeakSet<object>();
  function walk(v: unknown): unknown {
    if (typeof v === 'string') {
      let out = v;
      for (const { value: canary, secretId } of canaries) {
        if (canary.length === 0) continue;
        if (out.includes(canary)) {
          // Count substitutions across the whole string for this canary.
          const occurrences = out.split(canary).length - 1;
          total += occurrences;
          out = out.split(canary).join(`[REDACTED:${secretId}]`);
        }
      }
      return out;
    }
    if (Array.isArray(v)) {
      return v.map(walk);
    }
    if (v && typeof v === 'object') {
      if (seen.has(v)) return v; // cycle — leave reference alone
      seen.add(v);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  }
  const value = walk(input);
  return { value, count: total };
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
