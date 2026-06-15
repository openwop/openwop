# RFC 0102: A2UI agent-authored interface surfaces

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0102                                                            |
| **Title**         | A2UI agent-authored interface surfaces (declarative cross-trust-boundary UI as a vendor-namespaced envelope kind) |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-06-15                                                      |
| **Updated**       | 2026-06-15 (Draft → **Active** — 7-day window waived by maintainer to unblock implementation. **Amended in place at Active** the same day, per maintainer decision, to fold in a cross-session architecture review (`openwop-1`): kind is now **vendor-namespaced** (was a core `ui.a2ui-surface` — withdrawn, §A); `catalogVersion` is host-**enumerated** not free-string (§A/§C); the top-level `a2ui` capability block is **dropped** in favor of `supportedEnvelopes`/`schemaVersions` (§C); the invariant set expands to **five** + a threat-model update (§Conformance). Wire shape now stable at this revision.) |
| **Affects**       | `spec/v1/ai-envelope.md` (§"A2UI surfaces" — a vendor-namespaced kind convention + the `surface` closed-shape + asset/egress discipline; **no new core envelope kind**) · `spec/v1/host-capabilities.md` (§"A2UI surface support" — how a host advertises the kind + its enumerated catalog versions) · **host-supplied** `schemas/envelopes/vendor.<host>.a2ui.surface.schema.json` (the RFC specifies the RECOMMENDED closed `surface` `oneOf` shape; openwop core ships no schema for a vendor kind) · `SECURITY/invariants.yaml` (5 rows, below) · `SECURITY/threat-model-prompt-injection.md` (new agent→user render surface) · new conformance scenarios · `INTEROP-MATRIX.md` (advertisement column) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1                          |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

> **Amendment note (2026-06-15).** This RFC was flipped to `Active` and then amended at
> `Active` the same day — unusual, because `Active` normally locks the wire. Both were
> explicit sole-steward maintainer decisions during the bootstrap phase (`GOVERNANCE.md`),
> recorded here rather than silently editing the original rationale, per the project's
> "correct, don't rewrite history" rule. The amendment strictly *narrows* the wire surface
> (vendor-namespaced instead of a core carve-out), so it cannot break a client that hadn't
> shipped yet. The pre-amendment shape (core `ui.a2ui-surface`) was never implemented.

## Summary

Define a portable **convention** for an agent to emit a declarative
[A2UI](https://a2ui.org/) interface surface as a **vendor-namespaced** AI-envelope kind
(`vendor.<host>.a2ui.surface`): a component tree built from a **host-pinned, pre-approved
catalog**, with data bindings and actions. A consumer renders it with native widgets and
routes user actions back to the producing agent **without executing any agent-supplied
code**. The surface payload is a **closed** shape (`oneOf` over the host's day-1 component
set), the target catalog is a **host-enumerated** version (not a free string), actions are
**confined** to interrupt-resume / conversation-exchange, and untrusted-authored surfaces
are gated by the existing `meta.contentTrust` + `untrusted_content_blocks_approval` rules.
The kind advertises through the existing `supportedEnvelopes`/`schemaVersions` surface —
no new capability block, no core envelope kind, no OpenAPI/AsyncAPI change. Everything is
advertisement- or envelope-level and ignorable by existing clients.

## Motivation

RFC 0055 gave the envelope `media.{image,audio,file}` and a `meta.rendering` hint, so a
consumer can render images / audio / files / markdown / cards portably (`ai-envelope.md`
§"Rendering hints", §"Media reference payloads"). It stopped short of **interactive**
content: there is no convention for "show the user this form and send me back what they
enter." Today a host that wants agent-authored interactivity must either (a) hard-code
every form into its own client — so a third-party pack or a **remote cross-host A2A agent**
cannot ship a new form without that *consumer* host cutting a client release — or (b) let
the agent return markup/code, which is an injection surface across a trust boundary.

A2UI (Apache-2.0; v0.9.1 production, v1.0-candidate) is built for exactly this gap:
*"declarative data, not executable code, so agents can safely send rich UIs across trust
boundaries."* That property is load-bearing for OpenWOP, where runs are routinely served by
agents on **other hosts** (`a2a-integration.md`) and by **third-party packs**
(`node-packs.md`). A consumer renders a remote agent's surface safely precisely because it
renders only its own pinned catalog components and treats the surface as data.

The `clarification.request` universal kind already lets the model ask for more information
and carries an optional per-question answer `schema` plus a `contextType` UI hint — but it
leaves *rendering* to the host. An A2UI surface is the portable rendering answer to that
hint. The companion host decision is **ADR 0051** in the `openwop-app` reference app, gated
on this RFC.

## Proposal

### §A — `vendor.<host>.a2ui.surface` envelope kind (additive; the primary change)

A2UI surfaces ride the **existing vendor-namespaced-kind mechanism** (`ai-envelope.md`
§"Vendor-namespaced kinds": *"All non-universal kinds MUST be vendor-namespaced … core v1
does not specify domain-specific kinds"*). This RFC does **not** add a core kind; it
standardizes a *convention* any host MAY adopt under its own namespace, e.g.
`vendor.openwop-app.a2ui.surface`. (A future core, un-namespaced `ui.*` family — a portable
cross-host kind blessed like `media.*` — is explicitly deferred to its own carve-out RFC if
cross-host demand proves it; see Alternatives §6.)

A host that adopts the convention:

- Lists `vendor.<host>.a2ui.surface` in `Capabilities.supportedEnvelopes` and gives it a
  `schemaVersions[…]` entry, and serves its per-kind schema at the canonical location
  (`ai-envelope.md` §"Schema discipline"). It is **not** a MUST-recognize universal kind; a
  consumer that doesn't recognize it **MUST** fall back to default (store-without-render)
  rendering and **MUST NOT** fail the run (precedent: `artifact-type-store-without-render.test.ts`).

Payload (RECOMMENDED closed shape the host's per-kind schema SHOULD use):

```jsonc
{
  "type": "vendor.openwop-app.a2ui.surface",
  "schemaVersion": 1,
  "envelopeId": "env-surface-1",
  "correlationId": "run-1:node-2:turn-0:abc123",
  "payload": {
    "catalogVersion": "0.9.1",          // REQUIRED; MUST be one the host advertises (enumerated, §C)
    "surface": { /* closed oneOf over the host's day-1 component set */ },
    "reasoning": "…"                     // OPTIONAL per RFC 0030 §A (first property)
  },
  "partial": false,
  "meta": { "source": "ai-generation", "ts": "2026-06-15T10:00:00Z" }
}
```

Normative behavior:

1. **Closed surface (H6).** `payload.surface` **MUST** validate against a **closed**
   schema — a `oneOf` over the host's enumerated day-1 components, every object
   `additionalProperties: false`. An open `surface` object is non-conformant: it would make
   `a2ui-surface-no-code-exec` unenforceable.
2. **Closed catalog, fail-closed.** A consumer **MUST** render only components in the host's
   advertised catalog and **MUST** reject any out-of-catalog/malformed surface fail-closed
   (render a fallback notice). It **MUST NOT** execute or evaluate any agent-supplied code,
   script, expression, or markup. *(Invariant `a2ui-surface-no-code-exec`.)*
3. **Enumerated catalog version (C3).** `catalogVersion` **MUST** be one the host advertises
   as supported (an enumerated set, §C — never a free-string the producer invents). An
   unknown or higher version **MUST** be refused with `unknown_schema_version`
   (`ai-envelope.md` §"Schema version advertisement"). The stored `surface` **MUST** be
   **self-contained** — renderable from the payload alone, never a live reference into an
   external catalog — so a `:fork`/replay after the external A2UI standard ships a breaking
   version still renders deterministically.
4. **Action confinement.** A surface action, when invoked, **MUST** resolve to exactly one
   host-allowlisted target: a run interrupt resume (`interrupt.md` — collected data becomes
   the `resumeValue`) or a conversation exchange (RFC 0005). It **MUST NOT** invoke any
   other host endpoint, side effect, or RPC, and **MUST NOT** initiate any network egress
   from the surface. *(Invariants `a2ui-action-confinement`, `a2ui-surface-no-network-egress`.)*
5. **Streaming.** With `partial: true`, a consumer MAY render progressively but **MUST NOT**
   enable any action until the envelope finalizes (`partial: false`).
6. **Replay determinism.** The surface envelope replays by `correlationId`
   (`ai-envelope.md` §"Replay determinism"); on recovery/`:fork` the cached outcome is
   returned and the surface is **never** regenerated. Durable state is exactly `(surface
   envelope, submitted resume value)`.
7. **Trust boundary (reuse).** A surface emitted by a node that consumed untrusted MCP/A2A
   content **MUST** carry `meta.contentTrust: 'untrusted'`, propagated to derived
   `RunEventDoc`s. The existing rule that hosts **MUST NOT advance an `approval` interrupt
   on an untrusted envelope** (`untrusted_content_blocks_approval`) already blocks an
   untrusted-authored surface from driving an approval gate. *(Invariant
   `a2ui-untrusted-blocks-approval` makes the composition explicit for this kind.)*
8. **Redaction (SR-1).** The payload is walked by the SR-1 redaction harness like any
   envelope (`ai-envelope.md` §"Redaction"); no secret material renders.
   *(Invariant `a2ui-surface-no-secret-rendering`.)* Any asset the surface references obeys
   the `media-asset-url-tenant-scoped` discipline (RFC 0055 §C).

### §B — `meta.rendering.display` (no change)

The original draft proposed adding a `"a2ui"` value to the closed `display` enum. **Dropped
entirely** — the `type` discriminator is authoritative, and widening a closed validated
enum is the one non-clean-additive edge. No change to `meta.rendering` is proposed.

### §C — Advertisement via the existing surface (additive; no new block)

There is **no** top-level `a2ui` capability block (the original draft's was removed — two
discovery surfaces for one kind). A host advertises support exactly as every other kind
does:

- `Capabilities.supportedEnvelopes` includes `vendor.<host>.a2ui.surface`.
- `Capabilities.schemaVersions["vendor.<host>.a2ui.surface"]` gives the active schema version.
- The catalog detail a producer needs (which A2UI catalog versions + components the host
  renders) is conveyed **on the per-kind schema itself** — the closed `surface` `oneOf`
  *is* the component allowlist, and the schema's `catalogVersion` enum *is* the supported-
  version set. Discovery stays single-sourced; no peer of `agents`/`secrets`.

A host advertises the kind **only** when its renderer actually renders the enumerated
catalog versions (capability honesty; `OPENWOP_REQUIRE_BEHAVIOR=true` fails a dishonest
advertisement).

### Positive / negative examples

| # | Envelope / behavior | Outcome |
|---|---|---|
| P1 | §A payload, components all in the advertised closed set, `catalogVersion` advertised, `partial:false`, action resolves the open interrupt | Renders + collects resume value |
| N1 | `surface` missing / `payload.catalogVersion` absent | **Fails** the host's per-kind schema |
| N2 | `surface` carries an object outside the closed `oneOf` | **Fails** schema (`additionalProperties:false`) |
| N3 | `catalogVersion` the host doesn't advertise | **Refused** `unknown_schema_version` |
| N4 | Action targets anything but resume/exchange, or opens a network request | **Rejected** (`a2ui-action-confinement` / `a2ui-surface-no-network-egress`) |
| N5 | Untrusted-authored surface bound to an `approval` interrupt | Gate **blocked** (`untrusted_content_blocks_approval`) |
| N6 | Consumer that doesn't advertise the kind receives one | Store-without-render; run does **not** fail |

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1 — and strictly *cleaner* than the original draft:

- **§A** rides the existing vendor-namespaced-kind mechanism — no core kind, no enum
  change, no existing envelope reshaped. A host that doesn't advertise it never emits or
  receives it. This is the canonical additive profile (a new vendor kind).
- **§B** — no change proposed.
- **§C** — uses only existing required fields (`supportedEnvelopes`/`schemaVersions`); no
  new capability key.

No required→optional change, no required field added, no type change, no relaxed MUST, no
error-code remap. The §2.2 prohibition list is untouched. **Suite-vs-spec (§2.3):** the
client-render invariants (`no-code-exec`, `action-confinement`, `no-network-egress`,
`no-secret-rendering`) are enforced at the rendering consumer; OpenWOP's suite is
server-oriented, so they ship as **suite-version requirements with a reference-app client
probe**, not assertions every server must satisfy (Gap G3).

## Conformance

**Existing (adjacent):** `envelope-rendering-hint.test.ts` (optional/additive precedent),
`aiEnvelope.universalKinds.test.ts` (universal-vs-advertised discipline),
`artifact-type-store-without-render.test.ts` (unrecognized kind degrades — the N6
precedent), `media-url-inline-cap.test.ts` + `aiEnvelope.correlationReplay.test.ts`.

**New (capability-gated on the kind ∈ `supportedEnvelopes`):**

1. `a2ui-surface-shape` — server-free Ajv2020 validation of the closed `oneOf` `surface`
   schema; valid validates, open/extra props fail, missing `catalogVersion` fails.
2. `a2ui-surface-degrades` — host without the kind store-without-renders, run survives.
3. `a2ui-surface-version-refusal` — unadvertised `catalogVersion` → `unknown_schema_version`.
4. `a2ui-surface-replay` — re-emission by `correlationId` returns cached outcome; `type`
   divergence → `envelope_correlation_conflict`.
5. `a2ui-untrusted-blocks-approval` — untrusted surface can't advance an approval gate.

**Five SECURITY invariants** (`SECURITY/invariants.yaml`, each with a public test):
`a2ui-surface-no-code-exec`, `a2ui-action-confinement`, `a2ui-surface-no-network-egress`,
`a2ui-surface-no-secret-rendering` (SR-1), `a2ui-untrusted-blocks-approval`. The two pure
render-side ones (no-code-exec, no-network-egress) are reference-app client probes
(suite-version reqs). **`SECURITY/threat-model-prompt-injection.md`** gains a section: an
agent-authored rendered surface is a new agent→user output channel; the closed catalog +
text-only rendering + action confinement are its mitigations.

## Alternatives considered

1. **Do nothing — host-pre-compiled cards.** Rejected: a remote A2A agent / third-party
   pack can never ship a new form without the consumer host shipping client code.
2. **Agents return HTML/JS/markup.** Rejected: executing agent code across the trust
   boundary is the injection surface A2UI's declarative model eliminates.
3. **Invent an OpenWOP-native UI DSL.** Rejected: A2UI already ships an Apache-2.0 spec +
   streaming JSON + multi-framework renderers; OpenWOP composes with it.
4. **Adopt A2UI v1.0 client-to-server RPC.** Rejected here: a new agent→host control
   channel needs its own threat model + conformance. Actions stay confined (§A.4).
5. **Free-string `catalogVersion`.** Rejected (C3): an uncontrolled 5th version axis pinned
   to a pre-1.0 external standard breaks replay determinism. Host-enumerated + self-contained
   surface instead.
6. **Core un-namespaced `ui.a2ui-surface` kind (the original draft).** Rejected by maintainer
   review: a core kind is a deliberate carve-out (like `media.*` via RFC 0055), not justified
   by analogy. Vendor-namespacing is the spec default; a portable core kind can come later via
   its own carve-out RFC if cross-host demand proves it.

## Unresolved questions

1. ~~Keep/drop `display:"a2ui"`?~~ **Resolved: dropped** (§B).
2. ~~`catalogVersion` free-string vs registry?~~ **Resolved: host-enumerated** advertised
   set (§A.3/§C); settles this RFC's G2 and the existing open gap **E3** (`ai-envelope.md`
   §"Schema version advertisement").
3. **Minimum component set.** Does the convention mandate a normative minimum day-1 set a
   conforming `*.a2ui.surface` SHOULD support, or is each host's closed `oneOf` free to
   differ? (Affects cross-host predictability.)
4. **Action ↔ resume mapping shape.** Normatively specify how `(actionId, collected field
   values)` maps into the interrupt `resumeValue`, or leave it to the surface author + the
   interrupt's answer schema?
5. **Future core carve-out.** What evidence (cross-host adoption count?) should trigger
   promoting the convention to a core `ui.*` kind (Alternatives §6)?

## Implementation notes (non-normative)

- **Reference implementation:** ADR 0051 (`openwop-app`), card type
  `vendor.openwop-app.a2ui.surface`. Wires over the chat **card registry** + the `host.chat`
  `emitCard`/`updateCard` surface; actions map onto the existing `onAction('resolve', …)`
  interrupt contract — no new HITL, RPC, or route. **Phase 1 (renderer + closed catalog + 9
  tests) shipped: openwop-app#316.** A `core.chat.emitSurface` node is ergonomic sugar over
  `emitCard`.
- **Effort:** host per-kind schema + spec prose ≈ S; reference-app renderer ≈ M; conformance
  + threat-model ≈ S.

## Acceptance criteria

- [ ] Spec text merged (`ai-envelope.md` §"A2UI surfaces" + `host-capabilities.md`).
- [ ] Host-supplied per-kind schema documents the closed `surface` `oneOf` + enumerated
      `catalogVersion`; advertisement via `supportedEnvelopes`/`schemaVersions`.
- [ ] `SECURITY/invariants.yaml`: the **five** rows, each with a public conformance test;
      `threat-model-prompt-injection.md` updated.
- [ ] ≥1 conformance scenario per the five above (capability-gated); two as reference-app probes.
- [ ] CHANGELOG entry; `INTEROP-MATRIX.md` advertisement column.
- [ ] Reference host (`openwop-app`, ADR 0051) implements + passes; register sweep closed.

## References

- A2UI — https://a2ui.org/ (Apache-2.0, v0.9.1 / v1.0-candidate)
- RFC 0055 — Multimodal envelope variants & rendering hints (`media.*` precedent)
- RFC 0030 — Reasoning field; RFC 0031 §C — model-capability registry; RFC 0094 — kind discipline
- RFC 0005 — Conversation transport (exchange path)
- `spec/v1/ai-envelope.md` §§ "Vendor-namespaced kinds", "Schema discipline", "Schema version
  advertisement", "Replay determinism", "Trust boundary", "Redaction"
- `SECURITY/threat-model-prompt-injection.md`; `SECURITY/invariants.yaml`
  (`media-asset-url-tenant-scoped`, `untrusted_content_blocks_approval`)
- ADR 0051 (`openwop-app`) — companion host decision + reference impl
- Cross-session architecture review: `openwop-1` (crosstalk `A2UI`), 2026-06-15
- Prior art: MCP, A2A, Google A2UI
