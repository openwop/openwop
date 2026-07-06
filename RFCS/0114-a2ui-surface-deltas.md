# RFC 0114: A2UI Surface Deltas

| Field             | Value                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| **RFC**           | 0114                                                                                   |
| **Title**         | A2UI Surface Deltas                                                                    |
| **Status**        | `Accepted`                                                                             |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                          |
| **Created**       | 2026-06-26                                                                             |
| **Updated**       | 2026-07-06 (`Active → Accepted` — **single-witness** bootstrap steward waiver + maintainer autonomy grant. tier-1 reference host openwop-app advertises `a2uiSurface.deltaTransport:true` live + serves the emit-surface + delta-stream seams (host code openwop-app#1416). Three verifications GREEN: **① delta delivered + reconstructs** — a `?a2uiDelta=1` subscriber receives an RFC 6902 frame (op enum add/remove/replace, **no `test`**) that `applyPatch`-round-trips to the updated surface + re-validates against the closed catalog (host test `a2uiSurfaceDelta.test.ts`, 5 passed); **② recorded envelope stays FULL — the replay-pinned core** — a non-negotiating subscriber gets `{kind:'full'}` for both surfaces, the recorded event is the full `ui.a2ui-surface`, so `:fork`/replay read the full surface unaffected (delta is a per-subscriber transport projection only). **Steward-curl-verified** on `app.openwop.dev/api`: valid emit → `201 {eventId, sequence:1, surfaceRef, catalogVersion:"0.9.1"}` (records baseline full); **③ post-patch re-validation fail-closed** — **steward-curl-verified**: an out-of-catalog `iframe` component → `422 a2ui_surface_invalid` (`#/anyOf` "must match a schema in anyOf" — the closed A2UI catalog; `a2ui-surface-no-code-exec` holds post-patch). Applied-control witness (host test) + wire evidence, same tier as the 0117 FE unit tests. No new invariant (all RFC 0102 A2UI invariants hold post-patch). Tier-2 (second host advertising `deltaTransport`) carried forward.) · 2026-06-26 |
| **Affects**       | `spec/v1/ai-envelope.md`, `spec/v1/stream-modes.md`, `schemas/a2ui-surface-delta-frame.schema.json` (NEW), `schemas/capabilities.schema.json`, `spec/v1/host-capabilities.md`, conformance (recorded `ui.a2ui-surface.schema.json` UNCHANGED) |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                       |
| **Supersedes**    | —                                                                                     |
| **Superseded by** | —                                                                                     |

## Summary

RFC 0102's `ui.a2ui-surface` envelope carries a complete `surface` tree on every emission; a host that nudges one node re-sends the entire tree to every subscriber (~216 tokens/emit in the red-team estimate). This RFC adds an opt-in, **host-side delta transport**: the **recorded** `ui.a2ui-surface` envelope stays the **full** surface (replay-pinned, security-validated, durable-log-full — unchanged), and the host MAY transport RFC 6902 (JSON-Patch) deltas over the *run event stream* to subscribers that negotiate `?a2uiDelta=1`, materializing the full surface for everyone else, the event-log read, and replay. This mirrors the corpus's existing delta-projection pattern (`stream-modes` `updates`-over-`values`; RFC 0115 transport economy) and so does **not** touch the recorded envelope schema or the closed-catalog security model.

## Motivation

A2UI is the protocol's "continuous trainer" surface — an agent that streams UI updates (a progressing canvas, a live form) emits frequently, and each full-tree re-send is pure overhead when only a leaf changed. Unlike F1–F4 (host-internal), this leak is **spec-normative**: the wire shape itself mandates full-tree emission, so only a spec change can fix it. JSON-Patch (RFC 6902) is the obvious, well-specified incremental format and composes with the project's existing reference-by-id discipline.

## Proposal

### Schema change

`schemas/envelopes/ui.a2ui-surface.schema.json` is **UNCHANGED** — the recorded envelope payload stays `{ catalogVersion, surface, reasoning? }` (full surface). Deltas are a **stream-frame** shape carried over `GET /v1/runs/{runId}/events`, defined in a new `schemas/a2ui-surface-delta-frame.schema.json` (`$id` under `openwop.dev`, `additionalProperties: false`):

```jsonc
{
  "type": "object",
  "required": ["surfaceRef", "catalogVersion", "patch"],
  "properties": {
    "surfaceRef":      { "type": "string", "description": "The recorded ui.a2ui-surface envelope id this delta patches." },
    "catalogVersion":  { "type": "string", "description": "MUST equal the referenced full surface's catalogVersion." },
    "patch": { "type": "array", "minItems": 1,
      "items": { "type": "object", "required": ["op", "path"], "additionalProperties": false,
        "properties": {
          "op":   { "enum": ["add", "remove", "replace", "move", "copy"] },
          "path": { "type": "string" }, "from": { "type": "string" }, "value": {} } } }
  }
}
```

The `test` op is **excluded** (a fire-and-forget transport frame cannot act on a failed conditional); `move`/`copy` are permitted but optional to support.

### Normative requirements

- The host **MUST** record the canonical `ui.a2ui-surface` as a **full** surface (the recorded envelope is never a delta). Replay, `:fork`, the event-log read, and any non-negotiating consumer therefore always see the full surface — replay determinism and the closed-catalog security model are untouched by this RFC.
- A host advertising `a2uiSurface.deltaTransport: true` **MAY** deliver delta frames to a subscriber that opted in with the stream query parameter `?a2uiDelta=1`. When the parameter is **absent**, the host **MUST** deliver the materialized full surface (default behavior, unchanged). The host **MUST** be able to materialize the full surface for any subscriber at any time.
- A delta frame's `patch` **MUST** be a valid RFC 6902 document over the surface last delivered under `surfaceRef`. The consumer applies it and then **MUST** re-validate the result against the closed `catalogVersion` catalog schema before render (the same fail-closed validation a full surface receives, RFC 0102 §1). On **any** failure — bad `path`, `move`/`copy` of a missing node, or a post-apply surface that does not validate against the closed catalog — the consumer **MUST** fall back to store-without-render and request/await a full re-materialization; the host **MUST** re-send the full surface. A delta **MUST NOT** be a path by which an out-of-catalog component, opened tree, secret material, or dropped `meta.contentTrust:'untrusted'` reaches render — every A2UI security invariant (`a2ui-surface-no-code-exec`, `a2ui-action-confinement`, `a2ui-surface-no-network-egress`, `a2ui-surface-no-secret-rendering`, `a2ui-untrusted-blocks-approval`) **MUST** hold on the post-patch surface exactly as on a full one, and the SR-1 redaction harness **MUST** walk patch `value`s.
- `catalogVersion` on a delta frame **MUST** equal the referenced full surface's; a catalog-version change **MUST** start from a fresh full surface.

### Capability

A new top-level transport feature (deltas are a stream-transport optimization, not an envelope-payload kind):

```diff
+  "a2uiSurface": {
+    "type": "object", "additionalProperties": false,
+    "description": "RFC 0114. Host-side transport features over the recorded ui.a2ui-surface envelope.",
+    "properties": {
+      "deltaTransport": { "type": "boolean",
+        "description": "RFC 0114. Host delivers RFC 6902 delta frames over the run event stream to subscribers that negotiate ?a2uiDelta=1; full surface materialized otherwise. Recorded envelope stays full." }
+    }
+  }
```

### Examples

**Positive** — recorded full envelope, then a delta *frame* on the `?a2uiDelta=1` stream:
```
recorded ui.a2ui-surface envelope evt_9:  { "catalogVersion": "0.9.1", "surface": { ...full tree... } }
delta frame (stream only):  { "surfaceRef": "evt_9", "catalogVersion": "0.9.1", "patch": [ { "op": "replace", "path": "/children/2/text", "value": "Done" } ] }
```
A subscriber WITHOUT `?a2uiDelta=1` receives the materialized full surface for that update instead.

**Negative** — a delta whose `patch` `add`s a component not in the host's catalog → the post-apply surface fails closed-catalog validation → consumer renders the fallback notice and the host re-materializes full (the `a2ui-surface-no-code-exec` boundary holds).

## Compatibility

**Additive — and safer than a payload change.** The recorded `ui.a2ui-surface.schema.json` is **untouched**, so every existing emission validates byte-for-byte and the closed-catalog security model is unchanged. The new surface is a stream-frame schema + a `a2uiSurface.deltaTransport` capability flag + the `?a2uiDelta=1` query param — all opt-in. A consumer that never sends `?a2uiDelta=1` (every v1 client) sees today's full surfaces unchanged. Per `COMPATIBILITY.md` §4 the delta frame is a new normative requirement on previously-undefined stream behavior (additive).

## Conformance

- **Existing:** A2UI scenarios assert full-surface emission validates against the closed catalog; `a2ui-surface-no-code-exec` etc. are protocol-tier invariants with tests.
- **New:** `a2ui-surface-delta-transport.test.ts`, gated on `capabilityFamily(d,'a2uiSurface')?.deltaTransport`. Asserts: with `?a2uiDelta=1`, a full surface + a sequence of delta frames reconstruct the expected tree (apply RFC 6902 client-side) and **the reconstruction equals the full surface the host materializes for a non-negotiating subscriber** (delta and full agree); **a delta carrying an out-of-catalog `add`/`replace` value is rejected fail-closed** (the no-code-exec boundary holds post-patch) and forces full re-materialization; the recorded envelope (event-log read / replay) is always the full surface, never a delta.

## Alternatives considered

1. **Producer-emitted deltas (record patches in the durable event log).** Rejected for v1.x: it puts reconstruction-dependent patches in the replay-pinned log, forces the event-log read + replay + non-negotiating consumers to apply patches, and routes around the closed-catalog validation that makes `a2ui-surface-no-code-exec` enforceable. The host-side transport model keeps the recorded surface full (replay-safe, security-validated once) and still delivers the consumer-facing token win. A deeper producer-emitted model would be a v2-scale change with a much heavier security/replay treatment.
2. **Payload `anyOf{full,delta}` on the envelope schema.** Rejected (architect review 2026-06-26): the envelope is recorded + replay-pinned; an `anyOf` recorded-delta has the same hazards as (1). The delta belongs on the stream frame, not the recorded payload.
3. **JSON-Pointer-keyed scalar updates (no full RFC 6902).** Rejected: insufficient for add/remove of subtrees; RFC 6902 is the standardized superset.
4. **Do nothing.** Rejected: the consumer-facing full-tree re-send is real spec-observable overhead; the transport projection closes it without touching the recorded surface.

## Unresolved questions

1. ~~Negotiation channel?~~ **Resolved (architect 2026-06-26):** subscribe-time `?a2uiDelta=1` on the events stream (like `?streamMode=`/RFC 0115), not an envelope handshake — deltas are a per-subscriber transport choice.
2. Should `surfaceRef` delta lifetime be bounded (host MAY force a fresh full after N frames) to cap client-side reconstruction memory? (Lean: host-discretionary, SHOULD.)
3. ~~`move`/`copy` replay hazard?~~ **Resolved:** recorded surface stays full so replay never applies patches; the transported op set excludes `test`, and any `move`/`copy`/apply failure forces full re-materialization.

## Implementation notes (non-normative)

- The demo app's `canvas.write`/`emitCard-by-id` host-extensions are prior art for the register-once pattern but are non-normative host surfaces; this RFC standardizes the *transport* form.
- **Reconcile with openwop-app ADR 0148 A5 (host-internal A2UI delta lever):** The host computes the RFC 6902 diff **transport-side** between the prior emitted full surface and the new full surface, per run/`surfaceRef` (there is no shared A5 diff helper — A5 was declined as already-lean). The host records the full surface and emits that diff as the delta frame to negotiating subscribers — one model. The post-patch re-validation reuses the host's existing closed-catalog envelope validator, one validation path. Unlike RFC 0111, openwop-app HAS a real `ui.a2ui-surface` emitter and CAN witness this.
- Build the full-materialization path first (correctness floor + the non-negotiating default), then the delta transport.

## Acceptance criteria

- [ ] Spec text merged (`ai-envelope.md` + `stream-modes.md` §A2UI delta transport; recorded `ui.a2ui-surface.schema.json` UNCHANGED).
- [ ] `schemas/a2ui-surface-delta-frame.schema.json` (NEW) + `capabilities.schema.json` `a2uiSurface.deltaTransport` flag.
- [ ] `a2ui-surface-delta-transport.test.ts` in the suite (incl. the out-of-catalog-delta-fails-closed assertion).
- [ ] CHANGELOG entry.
- [ ] Reference host (openwop-app, real A2UI emitter) advertises `a2uiSurface.deltaTransport` and passes, or impl deferred.

## References

- RFC 0102 (`ui.a2ui-surface`); `spec/v1/ai-envelope.md` §"A2UI surfaces" (lines 348–372); `schemas/envelopes/ui.a2ui-surface.schema.json`.
- RFC 6902 (JSON Patch); RFC 6901 (JSON Pointer); RFC 0094 (schema closure).
- `spec/v1/stream-modes.md` (`updates` delta default — why B2 folds here).
- Sibling RFCs: 0111, 0112, 0113, 0115, 0116.
