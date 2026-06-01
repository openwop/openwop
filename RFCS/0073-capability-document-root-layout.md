# RFC 0073: Capability families are document-root properties of `/.well-known/openwop`

| Field | Value |
|---|---|
| **RFC** | 0073 |
| **Title** | Capability families are document-root properties of `/.well-known/openwop` |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@dtufts, steward) |
| **Created** | 2026-05-27 |
| **Updated** | 2026-05-31 (Draft → Accepted: the root layout is the normative MUST since Phase 1, all four+ reference hosts serve root since Phase 3, and Phase 4 now makes the conformance suite **enforce** root by dropping the accessor's wrapper-fallback — a wrapper-only host grades as non-conformant. Both Unresolved Questions resolved: the host-side mirror affordance and the schema's `additionalProperties` tolerance retire **together at v2.0**, when `capabilities.schema.json` tightens to forbid the wrapper. They are paired because both serve laggard *clients* reading discovery during the v1.x window; removing the mirror while the schema stays permissive would be incoherent.) |
| **Affects** | `spec/v1/capabilities.md`, `conformance/src/lib/*`, `conformance/src/scenarios/*`, `apps/workflow-engine/.../routes/discovery.ts`, `INTEROP-MATRIX.md` |
| **Compatibility** | `safety-fix` (corrective; brings implementations + suite to the schema's existing shape — no normative wire-shape change) per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

`schemas/capabilities.schema.json` already places every capability family
(`agents`, `secrets`, `aiProviders`, `auth`, `memory`, `multiAgent`,
`authorization`, …) as a **property of the document root** of the
`GET /.well-known/openwop` response — there is no `capabilities` wrapper
property, and `capabilities.md` §"Network-handshake shape" documents the full
response flat at the root. This was never stated as a `MUST`, so a `capabilities`
wrapper crept into the reference hosts and a cluster of newer conformance
helpers, tolerated only because the schema sets `additionalProperties: true`.
The result is a corpus that contradicts itself: the profile machinery reads
families at the root while the agent/MAS/memory capability-gating helpers read
them under `capabilities.*`, so **no single host can satisfy both at once**.
This RFC makes the root placement an explicit normative `MUST`, marks the
`capabilities` wrapper as a deprecated legacy shape for the v1.x window, and
migrates the conformance suite to read root-first with a temporary
wrapper-fallback.

## Motivation

A host author implementing strictly from `capabilities.schema.json` — the only
thing a third party reads — serves families at the document root. That is
exactly what the first non-steward adopter (MyndHyve) did, and it is correct.
But the published conformance suite contains two contradictory reader families:

- **Root readers (schema-correct):** `conformance/src/setup.ts` passes the full
  discovery doc; `conformance/src/lib/profiles.ts` reads `c.secrets`,
  `c.aiProviders`, `c.replay` at the root; `conformance/src/lib/multi-agent-capabilities.ts`
  reads `c.agents` at the root.
- **Wrapper readers (divergent):** `conformance/src/lib/agentRuntime.ts`,
  `agentLoop.ts`, `distillation.ts`, `subRunAttestation.ts`, and the scenarios
  `ai-envelope-shape.test.ts` + `approval-gate-flow.test.ts` read
  `doc.capabilities.<family>`.

| Host serves… | Profile predicates (root) | Agent/MAS gating (wrapper) |
|---|---|---|
| families at **root** (schema) | ✅ pass | ❌ soft-skip |
| families under **`capabilities`** (reference hosts) | ❌ predicates see `undefined` | ✅ pass |

Concretely, this fired on RFC 0070: MyndHyve advertised
`agents.manifestRuntime` correctly at the root, but `agentRuntime.ts` read
`capabilities.agents.manifestRuntime`, so the published scenario soft-skipped
against a spec-correct host (`INTEROP-MATRIX.md` §"RFC 0070"). The defect is a
direct tax on adoption: a host that reads the schema and implements it faithfully
cannot be graded by the suite. The fix belongs in the spec because the ambiguity
is a spec-clarity gap (`additionalProperties: true` masking an unstated layout
contract), not an implementation choice.

## Proposal

### 1. Normative prose (`spec/v1/capabilities.md`)

Add a normative subsection (new RFC 2119 `MUST`):

> **Capability families are document-root properties.** Every capability family
> — `protocolVersion`, `supportedEnvelopes`, `schemaVersions`, `limits`, and the
> optional families `agents`, `secrets`, `aiProviders`, `auth`, `memory`,
> `multiAgent`, `authorization`, and all others defined in
> `capabilities.schema.json` — MUST appear as a property of the **document root**
> of the `GET /.well-known/openwop` response. A host MUST NOT require a
> `capabilities` wrapper object to convey them.
>
> A `capabilities` wrapper object is a **deprecated legacy shape**. Through the
> v1.x migration window hosts MAY additionally mirror families under a
> `capabilities` object for backward compatibility, and clients/suites SHOULD
> read the document root first and MAY fall back to a `capabilities.*` wrapper.
> The wrapper is scheduled for removal; new hosts MUST serve at the root and
> SHOULD NOT emit the wrapper.

This is a clarification: the schema (`required: ["protocolVersion",
"supportedEnvelopes", "schemaVersions", "limits"]`, no `capabilities` property)
and `capabilities.md` §"Network-handshake shape" already describe the flat
shape. No schema diff is required — the schema is already correct.

### 2. Conformance suite — one shared root-first accessor

Add `conformance/src/lib/discovery-capabilities.ts`:

```ts
/** Root-first reader. Per capabilities.md (RFC 0073) families are document-root
 *  properties; a `capabilities` wrapper is the deprecated legacy shape, read
 *  only as a fallback through the v1.x migration window. */
export function capabilityFamily<T = Record<string, unknown>>(
  doc: Record<string, unknown> | undefined,
  name: string,
): T | undefined { /* doc[name] ?? doc.capabilities?.[name] */ }

export async function readCapabilityFamily<T>(name: string): Promise<T | undefined>;
```

Migrate every wrapper-reading helper/scenario onto it. The root-first/
wrapper-fallback pattern already exists ad hoc in the suite
(`aiEnvelope.capBreached.test.ts:36` does `body?.limits ?? body?.capabilities?.limits`;
`ai-envelope-shape.test.ts` dual-reads `supportedEnvelopes`) — this RFC
standardizes it into one accessor and applies it uniformly. Effect: the suite
grades **both** shapes correctly during the window, so MyndHyve's RFC 0070
scenario stops soft-skipping and the reference hosts keep passing.

### 3. Reference host — canonical root + deprecated mirror

`apps/workflow-engine/.../routes/discovery.ts` emits its families at the
document root (the canonical shape) while retaining the nested `capabilities`
object as a clearly-labelled **deprecated** mirror for the v1.x window. New
host authors copying the reference see families at the root.

### Examples

**Positive (canonical, root):**
```json
{ "protocolVersion": "1.1", "supportedEnvelopes": ["..."],
  "schemaVersions": {}, "limits": {},
  "agents": { "supported": true, "manifestRuntime": { "supported": true } },
  "secrets": { "supported": true } }
```

**Tolerated during window (root + deprecated mirror):** as above, plus a
`"capabilities": { "agents": {…}, "secrets": {…} }` mirror.

**Negative (non-conformant after the window closes):** families served **only**
under `capabilities` with nothing at the root — a strict reader finds no
families.

## Compatibility

**Safety-fix (corrective), non-breaking.** The normative wire contract —
`capabilities.schema.json` — does not change shape; this RFC adds a `MUST` that
was previously only implied and deprecates an undocumented wrapper.

- Existing **required** fields: unchanged (already root, already required).
- Existing **optional** family shapes: unchanged.
- Existing **event types / endpoints / error codes**: untouched.
- No existing `MUST` is relaxed; a new `MUST` is added that every schema-faithful
  host already satisfies.
- The only response-shape change is in the `examples/`-tier reference host
  (not the normative contract), and it is **additive** (families added at root;
  the legacy mirror retained). Clients reading either location keep working
  through the window.

A safety-fix normally carries a 90-day window; per the steward's standing
waiver for this corpus the additive-clarification window is waived
(bootstrap-phase one-approval, `CONTRIBUTING.md` §"Bootstrap-phase notes").

## Conformance

- **Existing coverage:** `profiles.ts` predicates + `multi-agent-capabilities.ts`
  already read the root (no change needed; they validate the canonical shape).
- **Migrated:** `agentRuntime.ts`, `agentLoop.ts`, `distillation.ts`,
  `subRunAttestation.ts`, `ai-envelope-shape.test.ts`,
  `approval-gate-flow.test.ts` move onto `capabilityFamily()` — root-first with
  wrapper fallback. No assertion semantics change; only the read location
  becomes shape-agnostic.
- **No new scenario** is required: this RFC does not add wire surface. The
  behavioral effect is that capability-gated scenarios stop soft-skipping
  against root-serving hosts — verified by re-running the RFC 0070 scenario
  against MyndHyve once the suite ships with the accessor.

## Alternatives considered

1. **Add a `capabilities` wrapper to the schema (canonicalize on nested).**
   Rejected: it is a breaking wire-shape change to a shipped, adopted contract —
   it would invalidate MyndHyve's just-verified production advertisement and the
   profile machinery, and it contradicts `capabilities.md`'s documented response.
2. **Flip only the divergent helpers to read `capabilities.*` (no spec change).**
   Rejected: it entrenches a shape the schema never defined, deepens the
   contradiction with the profile machinery, and still mis-grades schema-faithful
   third-party hosts. It is the "hack" path — a workaround, not a fix.
3. **Tell adopters to mirror under `capabilities` on their side.** Rejected:
   pushes a non-canonical shape onto the only real adopter and makes "easy to
   implement" worse (the wrapper is invisible in the schema, discoverable only by
   reading reference-host source).
4. **Do nothing.** Rejected: every schema-faithful third-party host is mis-graded
   indefinitely — a standing adoption tax that already fired once.

## Unresolved questions

Both resolved at `Draft → Accepted` (2026-05-31):

1. **Window length / what moves when.** *Resolved:* the change splits across two
   release boundaries by what each piece tests. The **conformance suite**'s
   wrapper-fallback is dropped **now** (v1.x) — the suite grades the *normative*
   shape (root MUST), so enforcing root-only is correct in v1.x and a wrapper-only
   host is non-conformant. The **host-side mirror** is a backward-compat affordance
   for laggard *clients* reading discovery, so it stays for the v1.x window and is
   removed at **v2.0**, paired with Q2.
2. **Schema forbid vs `SHOULD NOT`.** *Resolved:* leave `additionalProperties: true`
   with the prose `SHOULD NOT` for v1.x (forbidding the wrapper in-schema now is a
   breaking change under `COMPATIBILITY.md` §2.2 for any host still emitting the
   deprecated mirror). Tighten `capabilities.schema.json` to **forbid** the
   top-level `capabilities` property at **v2.0**, together with the host-mirror
   removal (Q1) — the permissive schema and the mirror are the same affordance and
   retire as one.

## Implementation notes (non-normative)

- **#276** landed Phase 1 (prose) + Phase 2 (accessor + agent-cohort helper
  migration) + Phase 3 for the primary reference host (`apps/.../discovery.ts`).
- **Phase 2b COMPLETE (#279 + tail):** all **78/78** capability-gated scenarios
  read via `capabilityFamily()` (root-first, deprecated-wrapper fallback). Shallow
  boolean reads use the default generic; deep chains carry an explicit per-family
  generic (reusing each file's named interface where present — e.g.
  `capabilityFamily<AuthCaps>(...)`); multi-family casts split into one call per
  family. No `as any`.
- **Phase 3 COMPLETE:** all four reference hosts (`apps/.../discovery.ts`,
  `examples/hosts/{in-memory,sqlite,postgres,python}`) emit families at the document
  root (canonical) via `{ ...advertisement, ...advertisement.capabilities }` (TS) /
  `{**payload, **payload["capabilities"]}` (Python), retaining the nested
  `capabilities` object as a DEPRECATED v1.x-window mirror — non-breaking for
  existing consumers + the hosts' own (nested-reading) tests. This closes the latent
  honesty gap where the hosts' root-read profile claims (`openwop-secrets`,
  `openwop-provider-policy`) were unverifiable against their previously nested-only
  shape.
- **Phase 4 (v1.x — this release, #DONE):** drop the accessor's wrapper-fallback
  in `conformance/src/lib/discovery-capabilities.ts` so the suite reads the document
  root only and enforces the Phase-1 MUST (a wrapper-only host grades as
  non-conformant). Tighten the `capabilities.md` prose to separate the suite
  (root-only) from clients (MAY fall back during the window).
- **Phase 5 (v2.0 — deferred, tracked):** remove the deprecated host-side
  `capabilities` mirror from the reference hosts AND tighten
  `capabilities.schema.json` to forbid the top-level `capabilities` property. These
  move together: both are v1.x backward-compat affordances for clients still reading
  the wrapper, so retiring one without the other is incoherent. Gated on the v2.0
  major (the schema forbid is a breaking change under `COMPATIBILITY.md` §2.2).
- **Separate gap (not this RFC):** `replay`, `interrupts`, `stream`, `runs`,
  `webhooks` are referenced by hosts/profiles but are not yet root properties in
  `capabilities.schema.json` (tolerated only by `additionalProperties: true`).
  Worth a follow-up so the schema is the complete contract.

## Acceptance criteria

- [x] Spec text merged (`capabilities.md` §"Document-root layout").
- [x] No schema change required (schema already root-shaped) — documented.
- [x] Conformance suite reads root-first via one shared accessor; wrapper readers migrated.
- [x] CHANGELOG entry under `[Unreleased]`.
- [x] All four reference hosts emit families at the document root (+ deprecated mirror).
- [x] All 78 capability-gated scenarios read via the root-only accessor, so RFC 0070's `agent-manifest-runtime` scenario (and the rest) grade a root-serving host instead of soft-skipping.
- [x] Phase 4 (v1.x): accessor wrapper-fallback dropped — the suite reads the document root only and grades a wrapper-only host as non-conformant; prose separates suite (root-only) from clients (MAY fall back during the window).
- [ ] Phase 5 (v2.0, deferred): remove the host-side mirror + tighten `capabilities.schema.json` to forbid the wrapper (paired; breaking, gated on the v2.0 major).

## References

- `spec/v1/capabilities.md` §"Network-handshake shape", §"Document-root layout"
- `schemas/capabilities.schema.json` (root properties; no `capabilities` wrapper; `additionalProperties: true`)
- `INTEROP-MATRIX.md` §"RFC 0070" (the soft-skip caveat this RFC resolves)
- RFC 0070 (agent-manifest runtime), RFC 0072 (agent inventory & dispatch)
- `COMPATIBILITY.md` §2.2 (wire-shape stability)
</content>
</invoke>
