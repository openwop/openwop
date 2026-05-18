# openwop Spec v1 — AI Envelope Primitive

> **Status: DRAFT v1.x (first cut, 2026-05-17).** Closes the long-standing gap where `Capabilities.supportedEnvelopes`, `Capabilities.schemaVersions`, `Capabilities.limits.envelopesPerTurn`, `Capabilities.limits.schemaRounds`, `Capabilities.limits.clarificationRounds`, `host.aiEnvelope.generate`, the `envelopeType` field on workflow-chain pack manifests, and the `openwop-interrupts` profile's `supportedEnvelopes.includes('clarification.request')` check all reference a wire concept whose own shape is not specified anywhere in v1 prose. This document specifies that shape, the universal kinds, the per-kind schema discipline, and the per-node "Envelope Contract" gate. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend. Fields marked **(stable)** lock; fields marked **(in-flight)** may shift compatibly before promotion to FINAL.

---

## Why this exists

Eight v1 surfaces already reference "envelopes" as a distinct wire concept:

- `capabilities.md` §"In-package shape" advertises `supportedEnvelopes: string[]`, `schemaVersions: Record<string, number>`, and three per-turn limits whose names (`envelopesPerTurn`, `schemaRounds`, `clarificationRounds`) are only meaningful if the engine recognizes an "envelope" as a thing the LLM emits.
- `schemas/capabilities.schema.json` lines 14–22 codifies that advertisement as `required v1` and gives `prd.create` / `theme.create` / `tasks.create` / `clarification.request` as the named example kinds.
- `host-capabilities.md` §host.aiEnvelope specifies a `ctx.aiEnvelope.generate({envelopeType, payload, ...}) → {envelopeType, payload, envelopeId, ...}` host-side capability whose return type is "an envelope" — but never says what an envelope's wire document looks like.
- `workflow-chain-packs.md` line 72 references `envelopeType: "prd.create"` as a config field on `core.ai.callPrompt` nodes — implying the node consumes a thing identifiable by that string.
- `profiles.md` lines 47 and 63 derive the `openwop-interrupts` profile from `c.supportedEnvelopes.includes('clarification.request')`.
- `host-extensions.md` allows per-host `supportedEnvelopes` extensions via vendor-namespaced kinds.
- `positioning.md` line 119 lists "LLM-driven workflows with structured envelopes (`prd.create` / `theme.create` / `tasks.create` / `clarification.request` / etc.)" as one of openwop's positioning claims.
- `apps/workflow-engine/backend/typescript/src/routes/discovery.ts` line 91 advertises `envelopesPerTurn: 32` from the reference host.

What none of these specify: the **AI Envelope's own wire shape**, the **universal kinds every engine must recognize**, the **per-kind schema discipline**, the **per-node permission set** (which kinds a given typeId accepts), the **dedup/replay semantics**, the **trust-boundary tagging**, or the **redaction invariant**. Hosts have been free-handing all of these. This document closes the gap.

---

## What an AI Envelope is (and is not)

An **AI Envelope** is openwop's canonical **inbound** wire format for a typed, structured emission produced by an LLM during workflow execution. An AI Envelope is a single JSON document whose top-level shape is fixed by this spec, whose `payload` shape is selected by a discriminator (`type`) and validated against a per-kind JSON Schema advertised in `Capabilities.supportedEnvelopes` + `Capabilities.schemaVersions`, and whose lifecycle is tied to the workflow node that produced it.

An AI Envelope is **distinct from `RunEventDoc`** (`schemas/run-event.schema.json`). The two are complementary:

| Concern | `RunEventDoc` | `AIEnvelope` |
|---|---|---|
| Direction | **Outbound** — host → client | **Inbound** — LLM → engine |
| Source of truth | Append-only run event log | Single emission, persisted by reference via `RunEventDoc.causationId` |
| Type discriminator | Fixed 48-variant enum, FINAL v1 | Open-ended kind catalog, host-advertised |
| Schema versioning | Per-event `schemaVersion` integer | Per-kind `schemaVersion` integer (advertised via `Capabilities.schemaVersions[kind]`) |
| Audience | Clients, observability tooling, replay | Engine, node dispatcher, artifact handlers |
| Lifecycle | Immutable after `appendAtomic` | Validated → gated → routed → recorded as `RunEventDoc` |

In short: **the LLM emits AI Envelopes; the engine emits `RunEventDoc`s.** When the engine accepts an envelope, it records the emission as one or more `RunEventDoc`s (`node.completed`, `artifact.created`, `agent.reasoned`, `clarification.requested` depending on kind), preserving the envelope's `correlationId` on the resulting events' `causationId` so projections can rebuild the causal chain.

This factoring keeps `RunEventDoc` frozen as the FINAL v1 outbound contract while the inbound surface can evolve under the AI Envelope spec.

---

## Primitive

An OpenWOP-compliant engine MUST accept AI Envelopes from any node whose `typeId` declares an envelope-emitting role (canonical example: `core.ai.callPrompt` per `host-capabilities.md` §host.aiEnvelope). The engine's contract is:

```typescript
interface AIEnvelopeAcceptor {
  /**
   * Accept a parsed AI Envelope from a node executor.
   *
   * Resolves with the routing decision (or rejects with `EnvelopeRefused`)
   * AFTER:
   *   1. shape validation against this spec
   *   2. kind validation against the host's `supportedEnvelopes` advertisement
   *   3. payload validation against the per-kind schema (when supplied)
   *   4. Envelope Contract gate (per-node permission set; see §Envelope Contract)
   *   5. BYOK redaction (SR-1 carry-forward; see §Redaction)
   *   6. trust-boundary normalization (see §Trust boundary)
   *
   * Emits the appropriate `RunEventDoc`(s) on accept.
   * Emits `cap.breached` and fails the node on engine-limit breach.
   */
  acceptEnvelope(envelope: AIEnvelope, ctx: NodeContext): Promise<EnvelopeOutcome>;
}
```

### `AIEnvelope` wire shape

```typescript
interface AIEnvelope<TPayload = unknown> {
  /** Discriminator for payload shape, kind routing, and contract gate. (stable) */
  type: string;                                    // e.g., "clarification.request" | "schema.request" | "error" | "vendor.myndhyve.prd.create"

  /** Per-kind schema version. Matched against `Capabilities.schemaVersions[type]`. (stable) */
  schemaVersion: number;                            // non-negative integer; absent → treat as 0

  /** Globally unique envelope id. Engine assigns if absent; opaque to consumers. (stable) */
  envelopeId: string;                               // ≤128 chars

  /**
   * Caller-stable identifier used for dedup, replay short-circuit, and
   * causal chaining across multi-turn emissions. If two envelopes in the
   * same run share `correlationId`, the second is treated as a re-emission
   * of the first (engine returns the cached outcome). Recommended:
   *   `${runId}:${nodeId}:${turnIndex}:${kindHash}`
   * (stable)
   */
  correlationId: string;                            // ≤128 chars

  /** Set when the emitting node is identifiable. Lifted to top level for
   *  per-node projection without payload coercion (mirrors RunEventDoc.nodeId). (stable) */
  nodeId?: string;

  /** Discriminated payload. Shape selected by `type`. (stable) */
  payload: TPayload;

  /** Wire metadata — see §EnvelopeMeta. (stable) */
  meta: EnvelopeMeta;

  /** Chunking — present when the envelope is one fragment of a streamed emission. (in-flight) */
  partial?: PartialInfo;
}

interface EnvelopeMeta {
  /** Provenance of this emission. (stable)
   *  - 'ai-generation' — LLM emitted this in a node turn
   *  - 'user'          — relayed from a user action (form fill, approval gate)
   *  - 'system'        — engine-synthesized (e.g., resume value normalization)
   */
  source: 'ai-generation' | 'user' | 'system';

  /** Trust tag mirroring RunEventDoc.contentTrust. Hosts MUST set 'untrusted'
   *  when the payload origin is an MCP tool result or an A2A inbound message
   *  per `mcp-integration.md` and `a2a-integration.md` trust-boundary rules. (stable) */
  contentTrust?: 'trusted' | 'untrusted';

  /** ISO 8601 UTC timestamp of emission. (stable) */
  ts: string;

  /** Optional W3C trace-context for distributed tracing propagation. (stable) */
  traceparent?: string;

  /** Optional human-readable label for ops dashboards (e.g., `"Draft PRD #2"`).
   *  Never used for routing; never persisted into event payloads in a
   *  security-relevant way. (in-flight) */
  label?: string;
}

interface PartialInfo {
  /** True for all chunks of a partial emission EXCEPT the final one. (in-flight) */
  isPartial: boolean;
  /** 0-indexed chunk position. (in-flight) */
  index: number;
  /** Total expected chunks. -1 when unknown (streaming without precount). (in-flight) */
  total: number;
}

type EnvelopeOutcome =
  | { status: 'accepted'; recordedEventIds: string[] }
  | { status: 'gated';    reason: string; gate: EnvelopeContractRefusal }
  | { status: 'invalid';  reason: string; details: ValidationDetail[] }
  | { status: 'breached'; reason: string; capKind: 'envelopes' | 'schema' | 'clarification' };
```

**Top-level fields are closed** (`additionalProperties: false` at the spec level). Vendor-namespaced extensions go inside `payload` or under `meta.<vendor>.<key>` per the canonical-prefix table in `host-extensions.md`.

---

## Universal kinds (normative)

Every OpenWOP-compliant engine MUST recognize the following four kinds. They are **always allowed** — Envelope Contract gates MUST NOT refuse them, and they MUST NOT be omitted from a host's `supportedEnvelopes` advertisement.

| Kind | Purpose | Bound to limit |
|---|---|---|
| `clarification.request` | LLM needs more information from the user before continuing. Engine SHOULD lift this to a `kind: "clarification"` interrupt per `interrupt.md`. | `limits.clarificationRounds` |
| `schema.request` | LLM asks the engine for the JSON Schema of a kind it doesn't have memorized (or wants to verify). Engine responds out-of-band by re-injecting the kind's schema into the model's context. | `limits.schemaRounds` |
| `schema.response` | LLM acknowledges receipt of a `schema.request` reply. Side-channel; never surfaces to users. | (none) |
| `error` | LLM cannot produce a payload satisfying the requested contract and is surfacing the failure deliberately rather than guessing. | `limits.envelopesPerTurn` |

### `clarification.request` payload

```typescript
interface ClarificationRequestPayload {
  questions: Array<{
    id: string;
    question: string;
    schema?: JSONSchema;  // optional answer schema (choices, free-text constraints, etc.)
  }>;
  contextType?: string;   // host-specific UI hint (e.g., "approval-feedback", "form-field")
}
```

When an engine receives a `clarification.request`, it MUST either:

1. Lift the payload to a `kind: "clarification"` `InterruptPayload` per `interrupt.md` §"`kind: 'clarification'`" and pause the node; OR
2. Refuse the run with the `not-applicable` reason if the host does not implement clarification (clarifications are part of the `openwop-interrupts` profile per `profiles.md`).

### `schema.request` payload

```typescript
interface SchemaRequestPayload {
  envelopeType: string;          // kind the LLM is asking about
  reason?: string;                // diagnostic; e.g., "I'm not sure my last emission matched"
}
```

The engine's response is **not** a `RunEventDoc` — it is an out-of-band addition to the LLM's context for the next turn, returned by the same mechanism the host uses to inject system-prompt content. The response document SHOULD include the per-kind JSON Schema at `Capabilities.schemaVersions[envelopeType]`.

### `schema.response` payload

```typescript
interface SchemaResponsePayload {
  envelopeType: string;          // kind the LLM is acknowledging
  ack: true;
}
```

Universal — never surfaces to users. Engines MAY count it against `limits.envelopesPerTurn` or exempt it; conformance does not lock this choice.

### `error` payload

```typescript
interface ErrorEnvelopePayload {
  code: string;                  // namespaced, e.g., "validation_failed", "tool_call_refused"
  message: string;                // human-readable
  details?: Record<string, unknown>;
}
```

The `error` envelope is the **LLM's** error report (the model said "I couldn't do that"). It is distinct from the HTTP-level `ErrorEnvelope` in `error-envelope.schema.json`, which is the **host's** error report. Hosts MUST NOT collapse these two surfaces — an `error` envelope is a successful turn whose payload happens to be an error report.

---

## Vendor-namespaced kinds

All non-universal kinds MUST be vendor-namespaced per `host-extensions.md` §"Canonical-prefix table." Core v1 does **not** specify domain-specific kinds (`prd.create`, `theme.create`, `tasks.create`, etc.). A host that wishes to advertise these kinds MUST namespace them — e.g., `vendor.myndhyve.prd.create`, `vendor.myndhyve.theme.create` — and supply the per-kind JSON Schema at the canonical schema location (see §Schema discipline).

The shorter, unnamespaced kind strings (`prd.create`, `theme.create`, `tasks.create`) MAY appear in `Capabilities.supportedEnvelopes` for **backward compatibility** with pre-v1.x hosts that shipped before this spec; conformant v1.x hosts SHOULD prefer the namespaced form. Migration guidance lives in `docs/migration/v1.0-to-v1.1.md`.

This separation lets core spec stay neutral while host vendors (myndhyve, future third parties) own their own kind catalogs and schemas.

---

## Schema discipline

Per-kind payload schemas are JSON Schema 2020-12 documents. They MUST be addressable by canonical URL and MAY be inlined in the host's discovery response.

### Canonical schema location

For a kind `K`, the canonical schema URL is:

```
{HostBase}/schemas/envelopes/{K}.schema.json
```

Where `{K}` is the kind string with dots preserved (e.g., `clarification.request.schema.json`). Hosts MUST serve these schemas with `Content-Type: application/schema+json` and `Cache-Control: public, max-age=300` (recommended).

### Schema version advertisement

The host MUST advertise the active schema version per kind via `Capabilities.schemaVersions`:

```json
{
  "supportedEnvelopes": ["clarification.request", "schema.request", "schema.response", "error", "vendor.myndhyve.prd.create"],
  "schemaVersions": {
    "clarification.request": 1,
    "schema.request": 1,
    "schema.response": 1,
    "error": 1,
    "vendor.myndhyve.prd.create": 2
  }
}
```

When the LLM emits an envelope with `schemaVersion` lower than the advertised floor for that kind, the engine MUST attempt the validation against the version advertised, log the mismatch as `envelope_schema_version_drift` in the OTel span, and proceed (warning-only). When `schemaVersion` is **higher** than advertised, the engine MUST refuse with `unknown_schema_version`.

### Validation outcomes

| Outcome | Engine behavior |
|---|---|
| Top-level shape mismatch (`type` missing, malformed JSON, `meta.source` absent) | Refuse synchronously with `invalid_envelope_shape`; emit `node.failed` if no retry budget remains. |
| Unknown `type` (not in `supportedEnvelopes`) | Refuse with `unknown_envelope_kind`; counts against `limits.schemaRounds` if retryable. |
| Top-level shape OK, but payload fails per-kind schema | Refuse with `envelope_payload_invalid`; counts against `limits.schemaRounds`. The engine SHOULD return the validation details to the LLM as a follow-up system message and allow re-emission. |
| `correlationId` already seen in this run with a different `type` | Refuse with `envelope_correlation_conflict`. |
| `correlationId` already seen with the same `type` and an `accepted` outcome | Return the cached `accepted` outcome (replay short-circuit; see §Replay determinism). |
| All checks pass | Outcome `accepted`; engine emits `RunEventDoc`(s) per §Production flow. |

The per-kind schema check is **warning-only** when `Capabilities.schemaVersions` does not list the kind. Hosts that want strict-only behavior advertise `envelopeStrictness: 'strict'` on the capability surface (see §Capability handshake integration).

---

## Envelope Contract (per-node permission set)

An **Envelope Contract** is a per-node declaration of which envelope kinds that node accepts. It is the gate by which `core.ai.callPrompt` says "I expect `clarification.request` or `vendor.myndhyve.prd.create`; refuse anything else."

The contract lives on the node's typeId definition (and is discoverable via `node-packs.md` §"Node manifest format"). The contract has three fields:

```typescript
interface EnvelopeContract {
  /** Kinds the engine will accept from this node. (stable) */
  accepts: string[];

  /** Universals are always implicit; this field is for documentation and conformance tooling. */
  alwaysAccepted: readonly ['clarification.request', 'schema.request', 'schema.response', 'error'];

  /** Refusal behavior for non-`accepts`, non-universal kinds. (stable) */
  refusalMode: 'fail-node' | 'discard-and-warn';
}
```

### Refusal contract (normative)

When a node emits an envelope whose `type` is neither universal nor in `EnvelopeContract.accepts`:

- `refusalMode: "fail-node"` (default) — the engine MUST emit `node.failed` with `error.code = 'envelope_contract_violation'`, `error.details.refusedType = <kind>`, `error.details.acceptedTypes = [<list>]`. The run transitions to `failed` unless the run's retry policy intervenes.
- `refusalMode: "discard-and-warn"` (advisory) — the engine MAY discard the envelope silently after emitting a `log.appended` event of `level: 'warn'` and proceed to the next emission. SHOULD NOT be used in production.

This refusal mode is observable from `RunEventDoc` projections and from the canonical error envelope (`error-envelope.schema.json`); no new error surface is introduced.

### Capability-gated typeIds

The Envelope Contract refusal is orthogonal to (and stacks atop) the existing capability-gated typeId refusal in `capabilities.md` §"Unsupported capability — refusal contract." A node whose typeId requires `host.aiEnvelope: supported` MUST be refused if that capability is absent, regardless of the contract's `accepts` list.

---

## Production flow

The engine's accept path for an AI Envelope is:

```
LLM emission (text-with-fenced-JSON OR direct JSON via host.aiEnvelope.generate)
  │
  ▼
Parser  ───  extract envelope document (informative: code-fence extraction is host choice)
  │
  ▼
Shape validation (this spec's top-level schema)
  │   ├── fail → refuse `invalid_envelope_shape`, emit `node.failed`
  │   └── ok
  ▼
Kind known? (`supportedEnvelopes.includes(type)`)
  │   ├── no → refuse `unknown_envelope_kind`; increment schemaRounds; allow retry
  │   └── yes
  ▼
Per-kind payload validation (`schemas/envelopes/{type}.schema.json`)
  │   ├── fail → refuse `envelope_payload_invalid`; increment schemaRounds; allow retry
  │   └── ok
  ▼
Envelope Contract gate (node's `accepts` list)
  │   ├── refused → emit `node.failed` per refusalMode
  │   └── ok
  ▼
Limit check (`envelopesPerTurn`, `clarificationRounds`, etc.)
  │   ├── breach → emit `cap.breached`; fail node
  │   └── ok
  ▼
BYOK redaction (SR-1 carry-forward; see §Redaction)
  │
  ▼
Trust normalization (`meta.contentTrust` → `RunEventDoc.contentTrust`)
  │
  ▼
Dedup/replay (`correlationId` lookup)
  │   ├── cached → return cached outcome; no new events
  │   └── fresh
  ▼
Route to handler (kind → handler registry; e.g., `clarification.request` → interrupt lift)
  │
  ▼
Emit `RunEventDoc`(s) preserving `causationId = envelope.correlationId`
  │
  ▼
Outcome `accepted` returned to executor
```

The handler-registry layer is not normative — hosts MAY implement it as a switch, a map, or a plugin system. What IS normative is the ordering: shape validation MUST precede kind validation MUST precede payload validation MUST precede contract gate MUST precede limit check MUST precede redaction MUST precede dedup MUST precede handler routing.

---

## Replay determinism

An OpenWOP-compliant engine MUST treat `correlationId` as the deterministic key for envelope dedup and replay. Specifically:

1. First envelope with `correlationId = C` in a run reaches the handler and produces the `accepted` outcome.
2. The engine persists the outcome (typically as the `RunEventDoc`s emitted by the handler; their `causationId = C` enables retrieval).
3. After process death + recovery, if the executor re-emits an envelope with the same `correlationId = C`, the engine consults the event log via `causationId = C`, finds the prior outcome, and returns the cached `EnvelopeOutcome` synchronously — no handler re-invocation, no new events.
4. If the re-emission's `type` differs from the cached, the engine MUST refuse with `envelope_correlation_conflict`; this protects against handler-state divergence.

Implementations MAY cache outcomes in memory for in-process replays; they MUST consult the event log for cross-process replays. This mirrors the `interrupt(payload)` replay contract per `interrupt.md` §"Replay determinism."

---

## Trust boundary

When a node consumes content from an untrusted source (MCP tool result per `mcp-integration.md`, A2A inbound message per `a2a-integration.md`), any envelope it subsequently emits whose payload incorporates that content MUST carry `meta.contentTrust: 'untrusted'`.

The engine MUST propagate `meta.contentTrust = 'untrusted'` to all `RunEventDoc`s emitted as a consequence of the envelope (setting `RunEventDoc.contentTrust = 'untrusted'`). Downstream LLM nodes that re-consume these events MUST treat the content as untrusted input per the prompt-injection-mitigation rules in `SECURITY/threat-model-prompt-injection.md`.

Hosts MUST NOT advance HITL approval gates (`kind: "approval"` interrupts) on the basis of an envelope whose `meta.contentTrust = 'untrusted'`. The approval-gate refusal code is `untrusted_content_blocks_approval`.

---

## Redaction (SR-1 carry-forward)

AI Envelopes MUST be routed through the same BYOK redaction harness applied to a fresh `MemoryEntry.put` per `agent-memory.md` §"SR-1 secret-redaction invariant." The fact that the LLM has been instructed not to emit secrets is **not** evidence to skip the redaction pass — the model can hallucinate secret-shaped substrings from prompt context, in-context examples, or tool results.

The redaction pass runs **after** validation and **before** dedup/handler routing in the §Production flow ordering. Redacted material MUST NOT appear in:

- The `RunEventDoc`s emitted as the envelope's outcome.
- The OTel span attributes (`openwop.envelope_kind`, `openwop.envelope_id`, etc.).
- The debug bundle export per `debug-bundle.md`.
- Any error envelope returned to the client.

See `SECURITY/invariants.yaml` row `envelope-redaction-sr-1-carry-forward` (to be added in the schema sibling to this spec).

---

## Capability handshake integration

This spec adds **no new required v1 fields** to `capabilities.schema.json`. It re-uses the existing surface:

| Field | Role under this spec |
|---|---|
| `supportedEnvelopes` (required v1) | The host's kind catalog. Universals MUST be present; vendor kinds MUST be namespaced. |
| `schemaVersions` (required v1) | The active per-kind schema version. Drives the §"Schema version advertisement" check. |
| `limits.envelopesPerTurn` (required v1) | Hard cap on envelopes per LLM turn. Engine emits `cap.breached { kind: 'envelopes' }` on breach per `capabilities.md` §"Engine-enforced limits." |
| `limits.schemaRounds` (required v1) | Hard cap on per-envelope retries when validation fails. Engine emits `cap.breached { kind: 'schema' }`. |
| `limits.clarificationRounds` (required v1) | Hard cap on total `clarification.request` envelopes per node. Engine emits `cap.breached { kind: 'clarification' }`. |

This spec adds **two OPTIONAL** fields to the `Capabilities` object (additive; v1.x):

```json
{
  "envelopeStrictness": "warn" | "strict",
  "envelopeContracts": {
    "advertised": true
  }
}
```

- `envelopeStrictness` (optional) — default `"warn"`. When `"strict"`, per-kind schema-version drift (LLM emits a `schemaVersion` lower than advertised) MUST cause refusal rather than warning.
- `envelopeContracts.advertised` (optional) — when `true`, the host's node-pack manifests carry `EnvelopeContract` blocks per §"Envelope Contract." Tooling and conformance scenarios gate on this flag.

Hosts that omit both fields are conformant; the defaults are `"warn"` and `false` respectively.

---

## Run event log integration

When the engine accepts an AI Envelope, the resulting `RunEventDoc`(s) MUST set:

- `causationId = envelope.correlationId` — preserves the causal chain.
- `contentTrust = envelope.meta.contentTrust` (when present) — propagates the trust tag.
- `nodeId = envelope.nodeId` (when present) — already covered by RunEventDoc's existing `nodeId` field.

The specific `RunEventDoc.type` emitted depends on the envelope kind. The recommended kind → event mapping for the universal kinds:

| Envelope kind | RunEventDoc type emitted |
|---|---|
| `clarification.request` | `clarification.requested` + (after lift to interrupt) `interrupt.requested` |
| `schema.request` | `log.appended` (level `debug`) |
| `schema.response` | `log.appended` (level `debug`) |
| `error` | `log.appended` (level `error`); SHOULD NOT emit `node.failed` (the LLM said the failure was deliberate) |

For vendor-namespaced kinds (e.g., `vendor.myndhyve.prd.create`), the host's handler chooses the appropriate `RunEventDoc.type` from the existing 48-variant enum. Hosts MUST NOT extend the `RunEventType` enum to add envelope-specific events; the envelope's identity rides on `causationId`, not on a parallel event-type surface.

---

## Wire serialization

AI Envelopes are JSON documents. Hosts MAY accept them through two transports:

1. **Direct JSON return from `host.aiEnvelope.generate`** (recommended) — the host capability already returns `{envelopeType, payload, envelopeId, ...}`; this spec extends that return shape to be a full `AIEnvelope` document.
2. **Fenced-JSON extraction from LLM text output** (informative) — hosts that route LLM output through a markdown-text channel MAY extract envelopes from ` ```json … ``` ` fenced blocks. The extraction algorithm is informative, not normative; what IS normative is that the **extracted document** validate against this spec's top-level shape.

Engines MUST tolerate multiple envelopes per turn (subject to `limits.envelopesPerTurn`). When multiple are extracted, they MUST be processed in the order encountered (top-to-bottom for fenced extraction; array order for direct JSON return).

---

## Conformance

The TS conformance suite (`conformance/src/scenarios/`) is the canonical authority for what conformance asserts. This document anticipates the following scenarios; each MUST be addable without an `eventLogSchemaVersion` bump since the envelope surface is additive over existing handshake fields:

- `aiEnvelope.universalKinds.test.ts` — host advertises all four universals; engine accepts each with valid payload; refuses invalid payloads with `envelope_payload_invalid`.
- `aiEnvelope.schemaDrift.test.ts` — emit envelope with `schemaVersion` below advertised → warn-and-continue under `envelopeStrictness: "warn"`; refuse under `envelopeStrictness: "strict"`.
- `aiEnvelope.correlationReplay.test.ts` — emit same envelope twice across process restart; second returns cached outcome; no duplicate `RunEventDoc`s.
- `aiEnvelope.contractRefusal.test.ts` — node typeId with `accepts: ['vendor.x.foo.create']`; emit `vendor.x.bar.create` → `node.failed` with `envelope_contract_violation`.
- `aiEnvelope.trustBoundaryPropagation.test.ts` — emit envelope after MCP tool result; verify `RunEventDoc.contentTrust = 'untrusted'`; verify approval gate refusal.
- `aiEnvelope.redaction.test.ts` — emit envelope whose payload contains a known BYOK substring; verify the substring is absent from emitted `RunEventDoc`s, OTel attributes, and debug bundle.
- `aiEnvelope.capBreached.test.ts` — exceed `envelopesPerTurn`; verify `cap.breached { kind: 'envelopes' }` and `node.failed`.

Profile gating: scenarios in this list run unconditionally against any host that advertises `supportedEnvelopes` (which is `required v1`). Scenarios for `envelopeContracts.advertised: true` and `envelopeStrictness: "strict"` gate on those optional flags.

---

## Migration

For pre-v1.x hosts that already advertise `supportedEnvelopes` with unnamespaced kind strings (`prd.create`, `theme.create`, etc.), this spec is **additive only**. Specifically:

1. Existing kinds continue to work; the four universals are now required to be advertised (every reference host already advertises `clarification.request`).
2. Hosts SHOULD add `meta` to envelopes they emit; engines SHOULD synthesize a default `meta.source = 'ai-generation'` for envelopes that omit it (warning-only for v1.x; required at v2).
3. `correlationId` SHOULD be populated; engines that find it absent SHOULD synthesize `${runId}:${nodeId}:${envelopeId}` and continue (warning-only for v1.x).
4. Vendor namespacing of new kinds is RECOMMENDED for v1.x and REQUIRED at v2.

See `docs/migration/v1.0-to-v1.1.md` for the field-by-field migration table once this spec is implemented in the reference host.

---

## Open spec gaps

| # | Gap | Owner |
|---|---|---|
| E1 | Streaming/partial envelope reassembly across SSE delivery — the `partial` field is specified but the cross-transport reassembly contract (when does the engine know a partial sequence is complete?) is not. | future v1.x |
| E2 | Multi-turn envelope conversations (an envelope whose handler emits a follow-up `schema.request` that the LLM answers in the next turn) — the `correlationId` chaining model is described but the conversation-state surface is not. | future v1.x |
| E3 | Vendor-kind registry — whether namespaced kinds (`vendor.myndhyve.prd.create`) should be advertised through a `kinds` registry parallel to the node-pack registry per `registry-operations.md`, or stay host-private. | future v1.x |
| E4 | Schema sub-typing — `vendor.x.prd.create` v2 might want to declare "everything v1 accepted, plus new optional field" without restating the v1 schema. JSON Schema $ref vs flat duplication; not locked. | future v1.x |
| E5 | Refusal-mode interaction with retry policies — `refusalMode: "fail-node"` plus a per-run retry policy may produce surprising loops if the LLM keeps emitting refused kinds. The interaction needs a worked example. | future v1.x |
| E6 | OTel attribute names — `openwop.envelope_kind`, `openwop.envelope_id`, `openwop.envelope_correlation_id` are implied but not added to `observability.md` §"Canonical span attributes" until this spec graduates from DRAFT. | follow-up |

These gaps do NOT block conformance against the DRAFT surface; they list what graduates to FINAL must close.

---

## References

- `capabilities.md` — `supportedEnvelopes`, `schemaVersions`, `limits.*` (the handshake surface this doc anchors against)
- `host-capabilities.md` §host.aiEnvelope — the `ctx.aiEnvelope.generate` host capability that produces envelopes
- `schemas/run-event.schema.json` — `RunEventDoc`, the outbound twin (this doc is the inbound twin)
- `schemas/error-envelope.schema.json` — host-side error envelope (distinct from this doc's `error` kind)
- `interrupt.md` — `clarification.request` lifts to `kind: "clarification"` interrupt
- `mcp-integration.md`, `a2a-integration.md` — trust-boundary rules consumed by `meta.contentTrust`
- `agent-memory.md` §"SR-1 secret-redaction invariant" — redaction harness this doc inherits
- `host-extensions.md` — canonical-prefix table for vendor namespacing
- `profiles.md` — `openwop-interrupts` profile derives from `supportedEnvelopes.includes('clarification.request')`
- `observability.md` — `cap.breached` event consumed by limit enforcement
- `node-packs.md` — node-pack manifest format that hosts `EnvelopeContract` blocks
- `workflow-chain-packs.md` — `envelopeType` config on `core.ai.callPrompt` nodes
- `SECURITY/threat-model-prompt-injection.md` — untrusted-content blocking rules
