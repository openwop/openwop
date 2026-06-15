# RFC 0102: A2UI agent-authored interface surfaces

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0102                                                            |
| **Title**         | A2UI agent-authored interface surfaces (declarative cross-trust-boundary UI as an AI-envelope kind) |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-06-15                                                      |
| **Updated**       | 2026-06-15 (Draft → **Active** — 7-day comment window waived by maintainer to unblock implementation; wire shape now locked per `RFCS/README.md` §"Status states". Open gaps G1/G2/G6 carry forward to the `Accepted` register sweep.) |
| **Affects**       | `spec/v1/ai-envelope.md` (new optional advertised kind `ui.a2ui-surface`, alongside the `media.*` family) · **new `schemas/envelopes/ui.a2ui-surface.schema.json`** + `Capabilities.supportedEnvelopes`/`schemaVersions` advertisement · `schemas/capabilities.schema.json` (new OPTIONAL `a2ui` catalog-detail block — supplementary; no required field added) · `spec/v1/host-capabilities.md` (§ "A2UI surface support") · `SECURITY/invariants.yaml` (`a2ui-surface-no-code-exec`, `a2ui-action-confinement`) · new conformance scenarios · `INTEROP-MATRIX.md` (advertisement column) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1                          |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Define `ui.a2ui-surface` — an **optional, advertised** AI-envelope kind whose payload is a
declarative [A2UI](https://a2ui.org/) interface surface (a component tree built from a
**host-pinned, pre-approved catalog**, with data bindings and actions). A consumer renders
it with native widgets and routes user actions back to the producing agent **without
executing any agent-supplied code**. It sits beside the `media.{image,audio,file}` family
introduced by RFC 0055 — a new optional kind, identified by the open `type` discriminator,
that unrecognizing consumers ignore. Actions are confined to the existing
interrupt-resume / conversation-exchange machinery (no new host RPC channel), and the
existing `meta.contentTrust` + `untrusted_content_blocks_approval` rules already gate
untrusted-authored surfaces. Everything here is advertisement- or envelope-level and
ignorable by existing clients.

## Motivation

RFC 0055 gave the envelope `media.{image,audio,file}` and a `meta.rendering` hint, so a
consumer can render images / audio / files / markdown / cards portably (`ai-envelope.md`
§"Rendering hints", §"Media reference payloads"). It stopped short of **interactive**
content: there is no portable kind that says "show the user this form and send me back
what they enter." Today a host that wants agent-authored interactivity must either
(a) hard-code every form into its own client — so a third-party pack or a **remote
cross-host A2A agent** cannot ship a new form without that *consumer* host cutting a client
release — or (b) let the agent return markup/code, which is an injection surface across a
trust boundary.

A2UI (Apache-2.0; v0.9.1 production, v1.0-candidate) is built for exactly this gap:
*"declarative data, not executable code, so agents can safely send rich UIs across trust
boundaries."* That property is load-bearing for OpenWOP specifically, where runs are
routinely served by agents on **other hosts** (`a2a-integration.md`) and by **third-party
packs** (`node-packs.md`). A consumer can render a remote agent's surface safely precisely
because it renders only its own pinned catalog components and treats the surface as data.

This is an **interop** concern — two consumers reading the same `ui.a2ui-surface` envelope
should render an equivalent UI — which is why the kind belongs in the spec rather than in
each app, the same reasoning RFC 0055 §"Rendering hints" used. The companion host decision
is **ADR 0051** in the `openwop-app` reference app, which is explicitly gated on this RFC
reaching `Accepted`.

The `clarification.request` universal kind (`ai-envelope.md` §"Universal kinds") already
lets the model ask for more information and carries an optional per-question answer
`schema` plus a `contextType` UI hint — but it deliberately leaves *rendering* to the host
("host-specific UI hint"). `ui.a2ui-surface` is the portable rendering answer to that hint:
a clarification or approval interrupt MAY be presented as an A2UI surface, with the
collected answer becoming the interrupt resume value.

## Proposal

### §A — `ui.a2ui-surface` envelope kind (additive; the primary change)

Add an **optional, advertised** universal-namespace kind `ui.a2ui-surface`, defined by the
spec (not vendor-namespaced) and modeled exactly on the `media.*` family
(`ai-envelope.md` §"Media reference payloads"):

- It is **not** one of the four MUST-recognize universal kinds. A host emits and advertises
  it only if it produces A2UI surfaces; a consumer that does not recognize it **MUST**
  fall back to its default (raw-JSON / store-without-render) rendering and **MUST NOT**
  fail the run. (Precedent: `artifact-type-store-without-render.test.ts`.)
- The `type` discriminator selects the payload schema, per `ai-envelope.md` §"Schema
  discipline". Because `type` is an **open, per-kind-schema-resolved** discriminator (the
  mechanism that let `media.*` be added additively), adding `ui.a2ui-surface` introduces
  **no enum change** and breaks no existing client.

Payload (canonical schema `schemas/envelopes/ui.a2ui-surface.schema.json`):

```jsonc
{
  "type": "ui.a2ui-surface",
  "schemaVersion": 1,
  "envelopeId": "env-surface-1",
  "correlationId": "run-1:node-2:turn-0:abc123",
  "payload": {
    "catalogVersion": "0.9.1",          // REQUIRED — the A2UI catalog the surface targets
    "surface": { /* A2UI surface document: components, bindings, actions */ },
    "reasoning": "…"                     // OPTIONAL per RFC 0030 §A (first property)
  },
  "partial": false,
  "meta": { "source": "ai-generation", "ts": "2026-06-15T10:00:00Z",
            "rendering": { "display": "card", "title": "Schedule the kickoff" } }
}
```

Normative behavior:

1. A producer (LLM node / host / cross-host A2A agent) MAY emit `ui.a2ui-surface`.
2. A consumer that renders it **MUST** render only components present in the host's
   advertised A2UI catalog (§C) and **MUST** reject any out-of-catalog component
   fail-closed (render a fallback notice), and **MUST NOT** execute or evaluate any
   agent-supplied code, script, expression, or markup. *(Invariant
   `a2ui-surface-no-code-exec`.)*
3. An action declared in the surface, when invoked by the user, **MUST** resolve to exactly
   one of: (a) a run interrupt resume (`interrupt.md` — the action's collected data becomes
   the `resumeValue`), or (b) a conversation exchange (`RFC 0005` — the data becomes the
   exchanged message). It **MUST NOT** invoke any other host endpoint, side effect, or RPC.
   *(Invariant `a2ui-action-confinement`.)*
4. **Streaming:** when emitted with `partial: true` (A2UI is a flat, incrementally
   generated JSON shape), a consumer MAY render progressively but **MUST NOT** enable any
   action until the envelope finalizes (`partial: false`).
5. **Replay determinism:** the surface envelope replays by `correlationId` per
   `ai-envelope.md` §"Replay determinism" — on recovery/`:fork` the cached outcome is
   returned and the surface is **never** regenerated; a `type` mismatch on re-emission
   refuses with `envelope_correlation_conflict`. The only durable state is `(surface
   envelope, submitted resume value)`; ephemeral client-side binding state of an
   unsubmitted form is not durable and MUST NOT be relied upon.
6. **Trust boundary (reuse, do not reinvent):** a `ui.a2ui-surface` emitted by a node that
   consumed untrusted MCP/A2A content **MUST** carry `meta.contentTrust: 'untrusted'`,
   propagated to derived `RunEventDoc`s per `ai-envelope.md` §"Trust boundary". The
   existing rule that hosts **MUST NOT advance an `approval` interrupt on the basis of an
   untrusted envelope** (`untrusted_content_blocks_approval`) therefore already blocks an
   untrusted-authored surface from driving an approval gate — no new taint primitive is
   introduced.
7. **Redaction & assets:** the payload is walked by the SR-1 redaction harness like any
   envelope (`ai-envelope.md` §"Redaction"); it carries no secret material. Any image/file
   the surface references **MUST** obey the `media-asset-url-tenant-scoped` discipline
   (RFC 0055 §C) and the `aiProviders.maxInlineMediaBytes` cap — no remote/guessable URLs.

### §B — `meta.rendering.display` value `"a2ui"` (OPTIONAL; recommended **dropped** — see Unresolved Q1)

RFC 0055 §B made `EnvelopeMeta.rendering.display` a **closed, schema-validated enum**
(`envelope-rendering-hint.test.ts` asserts unknown values are rejected). The `type`
discriminator in §A is already authoritative for `ui.a2ui-surface`, so a `display: "a2ui"`
value is **not required** and widening the closed enum carries a forward-compat cost
(clients pinned to the prior schema would reject the new value at validation time). This
RFC therefore **does not** propose the enum change in its primary form; `display: "card"`
already covers "render this structured payload as a card" for any consumer that keys off
`type`. Retained only as Unresolved Q1 in case reviewers want the hint on non-`ui.*`
payloads.

### §C — `a2ui` capability detail block (additive, OPTIONAL, supplementary)

The **primary** advertisement is the existing required surface: a host that supports the
kind lists `ui.a2ui-surface` in `Capabilities.supportedEnvelopes` and gives it a
`Capabilities.schemaVersions["ui.a2ui-surface"]` entry — **zero new required fields**,
identical to how `media.*` advertises. A new OPTIONAL top-level `a2ui` block adds the
catalog detail a producer needs to know what it may emit:

```jsonc
"a2ui": {
  "catalogVersion": "0.9.1",
  "components": ["heading", "text", "field.text", "field.date",
                 "field.select", "field.checkbox", "action.button"]
}
```

A host advertises `a2ui` (and lists the kind) **only** when its renderer actually renders
the named catalog version + component set — capability honesty per `host-capabilities.md`;
`OPENWOP_REQUIRE_BEHAVIOR=true` fails an advertisement the host does not honor. Absent the
listing, the host does not support A2UI surfaces and producers MUST NOT assume it.

### Positive / negative examples

| # | Envelope / behavior | Outcome |
|---|---|---|
| P1 | §A payload, all components in advertised catalog, `partial:false`, action resolves the open interrupt | Renders + collects resume value |
| N1 | `type:"ui.a2ui-surface"` with `payload.surface` missing | **Fails** per-kind schema validation |
| N2 | `payload.catalogVersion` absent | **Fails** schema (`catalogVersion` REQUIRED) |
| N3 | Surface references a component outside the advertised catalog | Consumer renders fallback, does **not** execute (`a2ui-surface-no-code-exec`) |
| N4 | Action attempts a host call other than resume/exchange | **Rejected** (`a2ui-action-confinement`) |
| N5 | Untrusted-authored surface (`meta.contentTrust:'untrusted'`) bound to an `approval` interrupt | Gate **blocked** (`untrusted_content_blocks_approval`, existing) |
| N6 | Consumer that does not advertise `ui.a2ui-surface` receives one | Falls back to raw render; run does **not** fail |

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1. Per-clause backward-compat guarantees:

- **§A new kind:** `type` is the open, per-kind-schema discriminator (not a closed enum);
  a new optional advertised kind changes no existing envelope shape. A consumer that
  doesn't list it in `supportedEnvelopes` never receives it; one that does but predates it
  degrades to raw render (clause N6). Identical additive profile to RFC 0055's `media.*`.
- **§B:** intentionally **omitted** from the normative change precisely to avoid the only
  potentially-non-additive edge (widening a closed, validated enum). See Unresolved Q1.
- **§C:** new OPTIONAL capability block + use of the existing required
  `supportedEnvelopes`/`schemaVersions` fields; absence = unsupported = prior behavior.

No required→optional change, no required field added, no type change, no relaxed MUST, no
error-code remap. Per `COMPATIBILITY.md` §2.2 the prohibition list is untouched.
**Suite-vs-spec (§2.3):** the client-render invariants (`a2ui-surface-no-code-exec`,
`a2ui-action-confinement`) are enforced at the rendering consumer; OpenWOP's conformance
suite is server-oriented, so they ship as **suite-version requirements with a reference-app
client probe**, not as assertions every server must satisfy (see Conformance + Gap G3).

## Conformance

**Existing coverage (adjacent):** `envelope-rendering-hint.test.ts` (RFC 0055 §B optional/
additive precedent), `aiEnvelope.universalKinds.test.ts` (universal-vs-advertised kind
discipline), `artifact-type-store-without-render.test.ts` (unrecognized kind degrades to
store-without-render — the §A clause N6 precedent), `media-url-inline-cap.test.ts` +
`aiEnvelope.correlationReplay.test.ts` (asset discipline + correlationId replay).

**New scenarios (capability-gated on `ui.a2ui-surface` ∈ `supportedEnvelopes`):**

1. **`a2ui-surface-shape`** — server-free Ajv2020 validation of
   `schemas/envelopes/ui.a2ui-surface.schema.json`: valid surface validates; missing
   `surface`/`catalogVersion` fail; `additionalProperties:false` honored. (Mirrors
   `envelope-rendering-hint.test.ts`, <1s.)
2. **`a2ui-surface-degrades`** — a host without the kind in `supportedEnvelopes` that
   receives one stores-without-render and does not fail the run (extends
   `artifact-type-store-without-render.test.ts`).
3. **`a2ui-surface-replay`** — re-emission with the same `correlationId` returns the cached
   outcome and does not regenerate; `type` divergence → `envelope_correlation_conflict`.
4. **`a2ui-untrusted-blocks-approval`** — a `ui.a2ui-surface` with
   `meta.contentTrust:'untrusted'` cannot advance an `approval` gate
   (`untrusted_content_blocks_approval`). Composes with existing trust-boundary scenarios.
5. **`a2ui-action-confinement`** *(reference-app client probe — suite-version req)* — a
   surface action resolves only an interrupt/exchange; any other target is rejected.
6. **`a2ui-surface-no-code-exec`** *(reference-app client probe — suite-version req)* — an
   out-of-catalog component renders a fallback and executes nothing.

**Capability gate:** `supportedEnvelopes` membership of `ui.a2ui-surface` (+ the optional
`a2ui` block). **Reference host:** emit/advertise/replay (1–4) can run against the
example hosts that opt in; render-side (5–6) is carried by the `openwop-app` reference app
(ADR 0051) — see Gap G3. **INTEROP-MATRIX:** add a `ui.a2ui-surface` advertisement column.

## Alternatives considered

1. **Do nothing — keep host-pre-compiled cards.** Rejected: a remote A2A agent or
   third-party pack can never ship a new interactive form without the *consumer* host
   shipping client code first. Cross-host interactivity stays impossible — the exact
   interop wall RFC 0055 §"Rendering hints" §Motivation describes, one level up
   (interactive instead of static media).
2. **Let agents return HTML/JS/markup.** Rejected: executing agent-authored code across the
   A2A / pack trust boundary is the injection surface A2UI's declarative model exists to
   eliminate (`threat-model-prompt-injection.md`).
3. **Invent an OpenWOP-native component DSL.** Rejected: A2UI already ships an Apache-2.0
   spec, a flat streaming JSON shape, and multi-framework renderers. A parallel DSL is
   duplicate work and worse interop; OpenWOP composes with it (same stance RFC 0055 took
   toward media *transports* in its §Alternatives).
4. **Adopt A2UI v1.0-candidate client-to-server RPC now.** Rejected for this RFC: an
   agent-driven RPC channel into the host is a new wire surface needing its own threat
   model and conformance. This RFC confines actions to the existing resume/exchange
   machinery (clause §A.3); RPC can be a later RFC once §A is in the field.
5. **Carry surfaces only via `meta.rendering.display` on a vendor kind (no new spec kind).**
   Rejected as the primary path: it leaves every host to invent a vendor namespace and
   defeats interop; the closed-enum widening also carries the §B compat cost. A dedicated
   spec kind is the additive, interoperable vehicle.

## Unresolved questions

1. **Keep or drop `display: "a2ui"` (§B)?** The `type` discriminator is authoritative, and
   widening the closed `display` enum is the one edge with a forward-compat cost. Lean:
   **drop**; revisit only if a concrete need to hint A2UI on a non-`ui.*` payload appears.
2. **Catalog registry & evolution.** Is `catalogVersion` a free string each host
   self-declares, or does OpenWOP maintain a small reserved registry of catalog versions
   (like the RFC 0031 §C model-capability registry, single-steward-bootstrapped)? And how
   does a host that has bumped its renderer render a *historical* surface on `:fork` — is
   carrying `catalogVersion` in the payload (it is, §A) sufficient, or is best-effort
   degrade acceptable for old surfaces?
3. **Minimum component set.** Does a host advertising `a2ui` have to support a normative
   minimum component set, or is the advertised `components[]` list purely descriptive?
4. **Action ↔ resume mapping shape.** Do we normatively specify how an A2UI action id +
   collected field values map into the interrupt `resumeValue` object, or leave it to the
   surface author + the interrupt's answer schema (`clarification.request §questions[].schema`)?
5. **A2A inbound surfaces.** When a remote A2A agent emits a surface that the local host
   renders, is the surface re-validated against the *local* host's catalog (yes, per §A.2),
   and is that the complete cross-host honesty story, or is a catalog handshake needed at
   the A2A layer (`a2a-integration.md`)?

## Implementation notes (non-normative)

- **Reference implementation:** ADR 0051 (`openwop-app`). It wires this over the existing
  chat **card registry** (`registerCard('ui.a2ui-surface')`) and the `host.chat`
  `emitCard`/`updateCard` surface, mapping A2UI actions onto the existing
  `onAction('resolve', resumeValue)` interrupt contract — so no new HITL, RPC, or route is
  introduced. ADR 0051 ships a host-only prototype first under a **vendor-namespaced**
  interim kind advertised `supported:false` (honest: no wire claim before this RFC is
  `Accepted`), then switches to the spec kind `ui.a2ui-surface`.
- **Emit ergonomics:** a `core.chat.emitSurface` pack node is sugar over `emitCard`; not
  required by the wire.
- **Effort:** schema + spec prose ≈ S; reference-app renderer over a pinned A2UI 0.9.1
  catalog subset ≈ M (the renderer is the bulk); conformance ≈ S.
- **Gap-closure plan:** situate under the envelope/rendering track of
  `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` (the same track RFC 0055 advanced).

## Acceptance criteria

- [ ] Spec text merged (`ai-envelope.md` §"A2UI surfaces" + `host-capabilities.md` § A2UI).
- [ ] Schemas: new `schemas/envelopes/ui.a2ui-surface.schema.json`; optional `a2ui` block in
      `capabilities.schema.json`; `supportedEnvelopes`/`schemaVersions` advertisement documented.
- [ ] `SECURITY/invariants.yaml`: `a2ui-surface-no-code-exec` + `a2ui-action-confinement`,
      each with a named conformance test.
- [ ] ≥1 conformance scenario covering the new surface (capability-gated); the four
      server-side scenarios in the suite, the two client-render probes in the reference app.
- [ ] CHANGELOG entry under the appropriate v1.x version.
- [ ] `INTEROP-MATRIX.md` advertisement column added.
- [ ] Reference host (`openwop-app`, ADR 0051) implements + passes the new scenarios, OR
      this RFC explicitly defers reference-host implementation (it does not — ADR 0051 is the gate).
- [ ] Register sweep: every row in `.gaps.md` / `.risks.md` closed or carried forward.

## References

- A2UI — https://a2ui.org/ (Apache-2.0, v0.9.1 production / v1.0-candidate; surfaces,
  catalog components, data binding, actions)
- RFC 0055 — Multimodal envelope variants & rendering hints (the `media.*` precedent extended here)
- RFC 0030 — Reasoning field (the OPTIONAL `reasoning` first-property convention)
- RFC 0031 §C — model-capability reserved registry (single-steward registry pattern, cf. Q2)
- RFC 0094 — universal-vs-advertised kind discipline / schema closure
- RFC 0005 — Conversation transport (exchange path for conversation-bound surfaces)
- `spec/v1/ai-envelope.md` §§ "Rendering hints", "Universal kinds", "Media reference payloads",
  "Schema discipline", "Replay determinism", "Trust boundary", "Redaction"
- `SECURITY/threat-model-prompt-injection.md`; `SECURITY/invariants.yaml`
  (`media-asset-url-tenant-scoped`, `untrusted_content_blocks_approval`)
- ADR 0051 (`openwop-app`) — A2UI agent-authored interactive chat surfaces (companion host decision + reference impl)
- Prior art: MCP, A2A, Google A2UI.
