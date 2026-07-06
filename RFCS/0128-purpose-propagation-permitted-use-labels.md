# RFC 0128: Purpose-propagation — permitted-use labels on synced data

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0128                                                            |
| **Title**         | Purpose-propagation — permitted-use labels on cross-host synced data |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | openwop-app maintainers                                         |
| **Created**       | 2026-07-06                                                      |
| **Updated**       | 2026-07-06                                                      |
| **Affects**       | `spec/v1/a2a-integration.md` (A2A message metadata carrier), `spec/v1/trigger-bridge.md`, `spec/v1/capabilities.md`, `schemas/capabilities.schema.json`, `schemas/trigger-event.schema.json`, conformance `purpose-propagation-*` scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                               |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

When a host sends a subject's data to a peer (an A2A message) or a downstream sink (a
trigger/sync event), the sender often carries a **permitted-use constraint** — "this record
may be used for `analytics` but not `advertising`" — derived from the subject's consent. Today
that constraint has no wire representation, so it is silently dropped at the host boundary and
the receiver cannot honor it. This RFC **additively** adds an OPTIONAL `permittedPurposes`
label to the A2A message and trigger-event envelopes, plus a `capabilities.purposePropagation`
advertisement. The **conformance-testable** normative core is deliberately narrow: a host that
advertises the capability MUST **re-emit the label on any onward hop** of the labelled data (an
observable, falsifiable promise). The internal-use restriction ("don't exceed the declared
purposes") is stated as **declared intent enforced by the receiver's local governance** and is
explicitly *not* conformance-tested — because a host's internal use is not observable over the
wire, and an unfalsifiable MUST is worse than none.

## Motivation

OpenWOP already models consent/permitted-use *within* a host (e.g. the openwop-app
`consentService` purpose vocabulary — `transactional`, `analytics`, `personalization`,
`marketing-email`, `marketing-sms`, `marketing-push`, `advertising`). But data does not stay in
one host: a CDP host syncs a contact to an ESP peer; an agent forwards a record over A2A. At
that boundary the permitted-use constraint evaporates — the receiver gets the data with no
machine-readable signal of what it may be used for, so it either over-uses (a compliance
breach the sender is accountable for) or the sender is forced to refuse the sync entirely.

This is a **cross-host promise**, and cross-host promises are wire shape (a receiver cannot
honor a constraint it cannot read). It is therefore the spec's job — not an implementation
choice — to define *how* a permitted-use label travels and *what* a conformant receiver
guarantees about it. `spec/v1/compliance.md` already draws the line between protocol-testable
guarantees and operator-attested posture; this RFC adds a protocol-testable guarantee
(**label propagation**) and is careful to leave the non-testable part (internal use) on the
operator/governance side of that line.

## Proposal

### 1. The `permittedPurposes` label (additive, OPTIONAL)

A sender MAY attach a `permittedPurposes` label to data-bearing wire surfaces:

```diff
   // the A2A message metadata (spec/v1/a2a-integration.md) and trigger-event.schema.json metadata
   "metadata": {
     "type": "object",
     "properties": {
+      "permittedPurposes": {
+        "type": "array",
+        "items": { "type": "string" },
+        "description": "Declared uses the receiver is permitted to make of the accompanying data. Opaque strings; a host maps them to its local purpose vocabulary. An empty array means 'no downstream use permitted'; absence means 'unlabelled' (no constraint asserted)."
+      }
     }
   }
```

- **Type:** `string[]`. **Optionality:** OPTIONAL. **Default:** absent ⇒ *unlabelled* (the sender
  asserts no constraint; NOT the same as `[]`, which asserts "no permitted use").
- **Vocabulary:** the wire carries **opaque strings**. The spec does NOT freeze a purpose enum
  (purposes are jurisdiction- and product-specific); a host maps them to its local vocabulary.
  The openwop-app values above are a non-normative reference.
- **Carrier:** the label is a property of the **data**, so it rides wherever the data flows — the
  A2A message `metadata` and the trigger/sync event `metadata`. It is NOT an A2A-only field.

### 2. `capabilities.purposePropagation` (additive advertisement)

```diff
   // GET /.well-known/openwop  (root families; schemas/capabilities.schema.json)
+  "purposePropagation": {
+    "supported": true,
+    "propagatesOnward": true
+  }
```

- OPTIONAL family. A host that neither reads nor forwards the label omits it (unknown-capability
  hosts ignore an incoming label — additive, no breakage).

### 3. Normative behavior — the conformance-testable core

A host that advertises `purposePropagation.supported: true`:

- **MUST** preserve and **re-emit** a received `permittedPurposes` label on **any onward hop** of
  the same data (a sync to a further sink, an A2A forward). This is the **observable** promise:
  a conformance run sends a labelled record through a two-hop chain and asserts the label
  survives the second hop unchanged (or narrowed — see below). *(This is the honesty gate.)*
- **MAY** narrow the label (remove purposes) on an onward hop — narrowing is always safe. It
  **MUST NOT** widen it (add purposes the sender did not grant). Widening is the testable
  violation.
- **MUST** treat `permittedPurposes: []` as "no onward use permitted" — a conformant host does not
  forward `[]`-labelled data to a further sink at all.

### 4. Internal-use restriction — declared intent, NOT conformance-tested

A receiver **SHOULD** confine its *own* use of the data to the declared purposes, enforced by its
local governance (e.g. openwop-app's `consentService.isPermittedForPurpose`). This is stated as
**declared intent**, deliberately **not** a wire `MUST` and **not** conformance-gated, because a
host's internal use is not observable over the wire — a conformance suite could not refute a
violation, so a `MUST` here would be an unenforceable (dishonest) normative claim. The wire's job
is to *carry* and *propagate* the constraint faithfully; *honoring* it internally is an
operator/governance responsibility on the `compliance.md` side of the protocol-vs-deployment line.

### Positive example

Host A (CDP) syncs a contact to Host B (an ESP peer) with
`metadata.permittedPurposes: ["analytics","marketing-email"]`. Host B advertises
`purposePropagation`, uses the record for an email campaign (permitted), and when it later
forwards an aggregate to Host C it re-emits `["analytics"]` (narrowed — dropped `marketing-email`).
The `purpose-propagation-onward` scenario asserts C received a label that is a **subset** of what
B received. **Pass.**

### Negative example

Host B advertises `purposePropagation` but forwards the record to Host C with
`["analytics","marketing-email","advertising"]` — it **widened** the label with a purpose A never
granted. The gated `purpose-propagation-onward` scenario fails under
`OPENWOP_REQUIRE_BEHAVIOR=true` (advertise-only-what-you-honor). A host that simply drops the
label on the onward hop also fails (the promise is *propagation*, not silent loss).

## Security & Compatibility

- **Compatibility: additive.** A new OPTIONAL metadata field + a new OPTIONAL capability family.
  Pre-RFC receivers ignore an unknown `permittedPurposes` label (no breakage); senders that never
  emit it are unaffected. No required→optional change, no shape change to existing fields.
- **No PII on the label.** `permittedPurposes` carries purpose *categories* (opaque strings), never
  subject identifiers or the subject's consent record — it is a use-constraint, not personal data.
- **Falsifiability (the design invariant).** Every normative `MUST` in §3 is refutable by a
  conformance run (label survives / narrows / never widens across an observable onward hop). The
  non-observable part (internal use) is intentionally demoted to `SHOULD`/declared-intent so the
  RFC makes no promise a suite cannot test — per the honesty rule that an unfalsifiable MUST is
  worse than no RFC.

## Host implementation note (non-normative)

openwop-app ADR 0268 (CDP-F) ships the host-side tagging + local enforcement (consent-gated
egress, field masking) already; this RFC is the cross-host propagation contract its §5 defers to.
The host reads `permittedPurposes` on ingest, maps it through `consentService`, and re-emits it on
`destination-sync` egress and A2A forwards. No host code advertising `purposePropagation` ships
before this RFC reaches `Accepted`.

## Open questions

1. Should the label additionally carry a **provenance** hint (the granting host / consent basis)
   so a downstream auditor can trace the grant, or does that leak subject-linkable data? (Proposed:
   no — keep the label a bare purpose set; provenance is an audit-log concern, not a wire label.)
2. Should `capabilities.purposePropagation` ride an existing governance/consent capability family
   rather than mint a new top-level family, if a suitable one exists at authoring time? (Proposed:
   mint the family; fold it in if a governance family is later consolidated.)
