# RFC 0102: A2UI agent-authored interface surfaces

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0102                                                            |
| **Title**         | A2UI agent-authored interface surfaces (declarative cross-trust-boundary UI as a core, advertised envelope kind) |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-06-15                                                      |
| **Updated**       | 2026-06-15 (Draft → **Active** — 7-day window waived by maintainer to unblock implementation. **Amended in place at Active** the same day — twice — per maintainer decision. (1) A first cross-session review (`openwop-1`) was made *before that reviewer had read this RFC* and recommended vendor-namespacing; it landed (#715). (2) The reviewer then re-ran the review **with the landed RFC in hand**, reversed to **core**, and the maintainer ruled core. This revision restores the **core, advertised kind `ui.a2ui-surface`** (a portable content-primitive family beside `media.*`, §A), keeps `catalogVersion` host-**enumerated** (§A/§C), keeps advertisement via `supportedEnvelopes`/`schemaVersions` (§C), keeps the **five** invariants + threat-model update (§Conformance), and fixes the `surface` discriminator to **`anyOf` + single-string-enum** (was `oneOf`, banned by `ai-envelope.md` §"Schema discipline" for LLM-emitted payloads). Wire shape now stable at this revision.) · **2026-06-15 (Active → `Accepted`)** — graduated on dual live evidence vs `@openwop/openwop-conformance@1.26.0`: the **openwop-app reference host** (rev `openwop-app-backend-00204-v75`, advertising `ui.a2ui-surface` in `supportedEnvelopes` + `schemaVersions[…]=1`, steward-curl-verified; non-vacuous proof 19/19 under `OPENWOP_REQUIRE_BEHAVIOR=true`) **and the MyndHyve non-steward witness** (rev `<MYNDHYVE_REV — pending final steward curl-verify>`, same advertisement + non-vacuous proof), both with the byte-identical core schema (`sha256 68f977c1…`). Vendor-namespaced detour (#715) fully superseded; the kind ships as the core `ui.a2ui-surface`. |
| **Affects**       | `spec/v1/ai-envelope.md` (new §"A2UI surfaces" — a **core, advertised** kind `ui.a2ui-surface` beside the `media.*` family + a carve-out clarification to §"Vendor-namespaced kinds") · `spec/v1/host-capabilities.md` (§"A2UI surface support" — how a host advertises the kind + its enumerated catalog versions) · new core `schemas/envelopes/ui.a2ui-surface.schema.json` (closed `surface` `anyOf` + enumerated `catalogVersion`) · `SECURITY/invariants.yaml` (5 rows, below) · `SECURITY/threat-model-prompt-injection.md` (new agent→user render surface) · new conformance scenarios · `INTEROP-MATRIX.md` (advertisement column) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1                          |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

> **Amendment note (2026-06-15).** This RFC was flipped to `Active` and then amended at
> `Active` the same day — twice — all explicit sole-steward maintainer decisions during the
> bootstrap phase (`GOVERNANCE.md`), recorded here rather than silently rewriting history.
> The sequence: (a) original Draft proposed a **core** `ui.a2ui-surface`; (b) a cross-session
> architecture review (`openwop-1`) recommended **vendor-namespacing**, which landed (#715) —
> but that review was made *before the reviewer had read this RFC* and rested on a literal
> reading of `ai-envelope.md` §"Vendor-namespaced kinds" that overlooked the `media.*`
> content-primitive carve-out; (c) the reviewer re-ran the review **with the RFC in hand**,
> reversed to **core** (vendor-namespacing would defeat the cross-host portability this RFC
> exists to deliver, and buys nothing on external-catalog stability that the enumerated
> `catalogVersion` handle does not already buy), and the maintainer ruled **core**. This
> revision is that ruling. No wire shipped under either intermediate shape — the reference
> app's `vendor.openwop-app.a2ui.surface` is an explicitly-interim Phase-1 prototype
> (`supported:false`) that switches to the core kind, so nothing breaks.

## Summary

Define `ui.a2ui-surface` — an **optional, advertised** AI-envelope kind, **core and
un-namespaced**, that sits beside the `media.{image,audio,file}` family (RFC 0055) as a
portable *content primitive*: where `media.*` carries an image/audio/file, `ui.a2ui-surface`
carries an **interactive** declarative [A2UI](https://a2ui.org/) surface — a component tree
built from a **host-pinned, pre-approved catalog**, with data bindings and actions. A
consumer renders it with native widgets and routes user actions back to the producing agent
**without executing any agent-supplied code**. The surface payload is a **closed** shape
(`anyOf` + single-string-enum discriminator over the day-1 component set — not `oneOf`,
which `ai-envelope.md` §"Schema discipline" bans for LLM-emitted payloads), the target
catalog is a **host-enumerated** version (not a free string), actions are **confined** to
interrupt-resume / conversation-exchange, and untrusted-authored surfaces are gated by the
existing `meta.contentTrust` + `untrusted_content_blocks_approval` rules. The kind
advertises through the existing `supportedEnvelopes`/`schemaVersions` surface — no new
capability block, no OpenAPI/AsyncAPI change. Everything is advertisement- or
envelope-level and ignorable by existing clients (an unrecognizing consumer
store-without-renders, exactly as for an unknown `media.*` kind).

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

### §A — `ui.a2ui-surface` envelope kind (additive; the primary change)

Add an **optional, advertised** kind `ui.a2ui-surface`, **core and un-namespaced**, modeled
exactly on the `media.*` family. This is a deliberate core carve-out, consistent with the
line `ai-envelope.md` §"Vendor-namespaced kinds" actually draws: the MUST to vendor-namespace
applies to **domain-specific** kinds (`prd.create`, `theme.create`); core reserves a small
set of **portable content-primitive families** — `media.*` (RFC 0055), and now `ui.*`. A
declarative surface assembled from a fixed catalog carries no business semantics; it is
generic *interactive content*, the sibling of an image or a file, so it belongs on the core
side of that line. (This RFC adds the carve-out clause to §"Vendor-namespaced kinds".) The
core kind is what makes a surface **portable**: a remote A2A agent on host X emits one and a
*different* consumer host Y renders it, because both resolve the same `type` discriminator
and the same canonical schema — impossible if every host invented its own `vendor.*` prefix.

A host that supports the kind:

- Lists `ui.a2ui-surface` in `Capabilities.supportedEnvelopes` and gives it a
  `schemaVersions["ui.a2ui-surface"]` entry. It is **not** a MUST-recognize universal kind; a
  consumer that doesn't advertise it **MUST** fall back to default (store-without-render)
  rendering and **MUST NOT** fail the run (precedent: `artifact-type-store-without-render.test.ts`).

Payload (canonical schema `schemas/envelopes/ui.a2ui-surface.schema.json`):

```jsonc
{
  "type": "ui.a2ui-surface",
  "schemaVersion": 1,
  "envelopeId": "env-surface-1",
  "correlationId": "run-1:node-2:turn-0:abc123",
  "payload": {
    "catalogVersion": "0.9.1",          // REQUIRED; MUST be one the host advertises (enumerated, §C)
    "surface": { /* closed anyOf + single-string-enum discriminator over the day-1 component set */ },
    "reasoning": "…"                     // OPTIONAL per RFC 0030 §A (first property)
  },
  "partial": false,
  "meta": { "source": "ai-generation", "ts": "2026-06-15T10:00:00Z" }
}
```

Normative behavior:

1. **Closed surface (H6).** `payload.surface` **MUST** validate against a **closed**
   schema — an `anyOf` with a single-string-enum discriminator over the day-1 components,
   every object `additionalProperties: false`. Schema authors **MUST NOT** use `oneOf`
   (`ai-envelope.md` §"Schema discipline" — `oneOf` is rejected/dropped by Tier-1 strict
   structured-output vendors). An open `surface` object is non-conformant: it would make
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
discovery surfaces for one kind). A host advertises support exactly as every other advertised
kind does:

- `Capabilities.supportedEnvelopes` includes `ui.a2ui-surface`.
- `Capabilities.schemaVersions["ui.a2ui-surface"]` gives the active schema version.
- The catalog detail a producer needs (which A2UI catalog versions + components the host
  renders) is conveyed **on the per-kind schema itself** — the closed `surface` `anyOf`
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
| N2 | `surface` carries an object outside the closed `anyOf` | **Fails** schema (`additionalProperties:false`) |
| N3 | `catalogVersion` the host doesn't advertise | **Refused** `unknown_schema_version` |
| N4 | Action targets anything but resume/exchange, or opens a network request | **Rejected** (`a2ui-action-confinement` / `a2ui-surface-no-network-egress`) |
| N5 | Untrusted-authored surface bound to an `approval` interrupt | Gate **blocked** (`untrusted_content_blocks_approval`) |
| N6 | Consumer that doesn't advertise the kind receives one | Store-without-render; run does **not** fail |

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1:

- **§A** adds a new **optional, advertised** core kind beside the `media.*` family — no
  enum change, no existing envelope reshaped. A host that doesn't advertise it never emits
  or receives it; an unrecognizing consumer store-without-renders. This is the canonical
  additive profile (a new advertised kind, exactly like RFC 0055 added `media.*`).
- The carve-out clause added to `ai-envelope.md` §"Vendor-namespaced kinds" is a
  **clarification, not a relaxation**: it scopes the existing "MUST be vendor-namespaced"
  to *domain* kinds and names the reserved core content-primitive families (`media.*`,
  `ui.*`). No host relied on "`ui.*` is forbidden", so no interop guarantee is weakened.
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

1. `a2ui-surface-shape` — server-free Ajv2020 validation of the closed `anyOf` `surface`
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
6. **Vendor-namespaced `vendor.<host>.a2ui.surface` (interim #715 amendment).** Briefly
   adopted, then rejected on re-review: vendor-namespacing demotes a portable cross-host
   primitive to a per-host private feature (O(N) consumer↔producer coordination vs O(1)),
   defeating the cross-host portability in §Motivation; and it does not insulate core from
   the external A2UI catalog's instability — the enumerated `catalogVersion` handle (§A.3)
   does that, identically, whether the kind is core or vendor. A core kind beside `media.*`
   is the additive, interoperable vehicle. The reference app's interim vendor kind remains a
   Phase-1 prototype that switches to `ui.a2ui-surface`.

## Unresolved questions

1. ~~Keep/drop `display:"a2ui"`?~~ **Resolved: dropped** (§B).
2. ~~`catalogVersion` free-string vs registry?~~ **Resolved: host-enumerated** advertised
   set (§A.3/§C); settles this RFC's G2 and the existing open gap **E3** (`ai-envelope.md`
   §"Schema version advertisement").
3. **Minimum component set.** Does the kind mandate a normative minimum day-1 set a
   conforming `ui.a2ui-surface` host SHOULD support, or is each host's closed `anyOf` free
   to differ? (Affects cross-host predictability — sharper now that the kind is core.)
4. **Action ↔ resume mapping shape.** Normatively specify how `(actionId, collected field
   values)` maps into the interrupt `resumeValue`, or leave it to the surface author + the
   interrupt's answer schema?
5. **Further `ui.*` family members.** What other portable interactive primitives (beyond a
   surface) might join the `ui.*` family, and what evidence should gate each addition?

## Implementation notes (non-normative)

- **Reference implementation:** ADR 0051 (`openwop-app`). Wires over the chat **card
  registry** + the `host.chat` `emitCard`/`updateCard` surface; actions map onto the existing
  `onAction('resolve', …)` interrupt contract — no new HITL, RPC, or route. **Phase 1
  (renderer + closed catalog + 9 tests) shipped under the interim vendor kind
  `vendor.openwop-app.a2ui.surface` (`supported:false`): openwop-app#316.** Phase 2 switches
  the card type to the core `ui.a2ui-surface` and advertises it once this RFC's core schema
  lands. A `core.chat.emitSurface` node is ergonomic sugar over `emitCard`.
- **Effort:** core schema + spec prose ≈ S; reference-app renderer ≈ M; conformance
  + threat-model ≈ S.

## Acceptance criteria

- [ ] Spec text merged (`ai-envelope.md` §"A2UI surfaces" + §"Vendor-namespaced kinds"
      carve-out clause + `host-capabilities.md`).
- [ ] Core schema `schemas/envelopes/ui.a2ui-surface.schema.json` — closed `surface` `anyOf`
      + enumerated `catalogVersion`; advertisement via `supportedEnvelopes`/`schemaVersions`.
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
