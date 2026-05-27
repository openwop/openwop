# MyndHyve adoption evidence — RFC 0071 Phase 1 (artifact-type packs)

> **🛡 Steward verdict (openwop, 2026-05-27): ✅ RFC 0075 §P1-3 / G3 CLOSED — `registered:true` is now downstream-verifiable.** MyndHyve shipped the RFC 0075 host-side close-out to production (rev `workflow-runtime-00398-vup`, 100% traffic) and the steward independently curl-verified `https://api.myndhyve.ai`: (1) `host.artifactTypes.types[]` advertises all **7** reconciled types each as `{ validated:true, validation:"open", schemaVersion:1, registrationSource:"host" }` (per-type facets P1-1/P1-2, lenient-AI strictness P0-2, host-registered tier P0-1), and the top-level `schemaVersions` is the matching 7-type set (the earlier code-vs-prod 16→7 drift is closed); (2) **all 7 `GET /schemas/artifacts/vendor.myndhyve.{prd,theme,screen,personas,brandResearch,moodboard,componentLibrary}.schema.json` resolve `200 application/schema+json` with `$id` == the canonical URL** (P1-3). The P1-3 hole — `registered:true` for host-native types being unfetchable downstream — is now actually plugged, steward-confirmed: a consumer can resolve the shape of every artifact MyndHyve emits as `registered:true`. This was the last open item on MyndHyve's side for the RFC 0071 + RFC 0075 arc.
>
> **🛡 Steward verdict (openwop, 2026-05-27): ✅ ACCEPTED — RFC 0071 Phase 1 graduated `Active → Accepted`.** The three gaps flagged in the 2026-05-26 canary verdict are now closed and **independently steward-verified**: MyndHyve promoted Slice B to **100% production traffic** (`workflow-runtime-00396-cuj`) and the steward curled `https://api.myndhyve.ai/.well-known/openwop` directly (2026-05-27), confirming `capabilities["host.artifactTypes"]: {supported:true, store:true, render:true, export:[pdf,pptx,docx,md,png,svg]}` served **unconditionally** (env gate dropped) with all **16 `vendor.myndhyve.*` `schemaVersions`** present, backed by the live `WorkflowNode.artifactType` validate-before-emit binding. The behavioral conformance (install/produce, 15 tests) was MyndHyve-run via the test seam (the seam is a test-deployment surface, not on production — the same evidence shape as the 0045–0054 / 0058 / 0061 graduations: steward verifies the production *advertisement*, host runs the seam-driven conformance). `spec/v1/artifact-type-packs.md` promoted DRAFT → FINAL. **RFC 0071 overall `Status` stays `Active`** because Phase 2 (chat card packs, `kind: "card"`) remains `Draft`. The "Accepted ✅" cells below — flagged as optimistic on 2026-05-26 — are now accurate.
>
> _(Historical 2026-05-26 canary verdict, for the record: NOT YET ACCEPTED — the advertisement then served a 0%-traffic canary, was conformance-env-gated, and the production binding was deferred to Slice B. All three are now resolved per the verdict above.)_

> **⚠ DRAFT — conformance verified on the canary; traffic promote pending.** The
> four 0071 scenarios pass against the `rfc0071`-tagged canary revision
> (`workflow-runtime-00392-bug`, serving **0% traffic**), MyndHyve-side
> suite-verified 2026-05-26. The **promote to 100% traffic** and the
> openwop-side curl-verify against `api.myndhyve.ai` are the remaining steps
> before this is final evidence. Until traffic is promoted, cite this as
> "canary-verified," not "live on the production endpoint."

**Status: 📥 Graduating `Active → Accepted` (Phase 1) — 2026-05-26 (canary-verified, promote pending).** Openwop-side
companion to the migration request at
[`0071-artifact-type-packs-migration-request.md`](./0071-artifact-type-packs-migration-request.md).
Canonical per-row evidence belongs in [`../../INTEROP-MATRIX.md`](../../INTEROP-MATRIX.md);
this file is the index + the migration story, mirroring the
[0045–0054 cohort format](./0045-0054-cohort-summary.md).

MyndHyve is the non-steward host whose advertisement + passing conformance
fires the `Active → Accepted` gate for RFC 0071 Phase 1
(`RFCS/0001-rfc-process.md` §"Promotion to Accepted").

---

## What graduated

| RFC | Capability advertised (live, curl-verified) | Conformance evidence | Status |
|---|---|---|---|
| **0071 Phase 1** artifact-type packs | `capabilities["host.artifactTypes"]: { supported, store, render, export[] }` + per-type `capabilities.schemaVersions["vendor.myndhyve.*"]` | `artifact-type-pack-install.test.ts` + `artifact-type-store-without-render.test.ts` (via the `artifacttypes/{install,produce}` seam) + the two server-free floors | Accepted ✅ |

This closes the two `host-pending` behavioral scenarios that shipped in
openwop/openwop#270.

## How we adopted it — map-onto-the-wire, not new product work

RFC 0071 generalizes MyndHyve's downstream **Canvas Type** system
(`ArtifactTypeDefinition` + `CanvasManifest.artifactTypes[]`) onto the protocol.
We took the blessed gate-closing path from the request ("…or the documented
`POST /v1/host/sample/artifacttypes/*` seam"):

- **Discovery advertisement.** `host.artifactTypes` is emitted at the dotted
  key the conformance reader resolves (`capabilities["host.artifactTypes"]`),
  with the 16 `vendor.myndhyve.*` artifact-schema versions under
  `capabilities.schemaVersions`. Both are gated on the conformance deployment
  env (`OPENWOP_CONFORMANCE_FIXTURES`), paired with the seam that implements
  them — see "Honest scope" below.
- **Host-sample seam** (`POST /v1/host/sample/artifacttypes/{install,produce}`):
  - `install` bounded-compiles each pack schema (RFC 0071 R1 schema-bomb
    defense: serialized-size / `$ref`-depth / keyword-count bounds before the
    Ajv compile) and registers the compiled validators; a foreign `kind` →
    `pack_kind_invalid`, an over-bounds schema → `pack_validation_failed`.
  - `produce` runs the binding contract (`artifact-type-packs.md` §"Binding
    the existing artifact surfaces"): a registered + schema-valid payload is
    stored + rendered and the run completes with
    `artifact.created { registered: true }`; a registered + invalid payload is
    **not** stored and the run fails; an unregistered type is the permanent
    first-class tier (`registered: false`, still stored).

**MyndHyve host commit:** `f47f9d07d` (`feat(rfc-0071): host.artifactTypes
advertisement + artifact-type pack install/produce seam`).
**Revision:** `workflow-runtime-00392-bug` (canary tag `rfc0071`, deployed
`--no-traffic` from the `workflow-runtime-00390-vuh` baseline; **promote to 100%
pending**).

## Discovery — curl-verified (canary tag URL)

Against `https://rfc0071---workflow-runtime-gjw5bcse7a-uc.a.run.app/.well-known/openwop`
(2026-05-26); identical shape will serve `https://api.myndhyve.ai/.well-known/openwop`
once traffic is promoted:

`host.artifactTypes` is at the dotted key the conformance reader resolves
(`capabilities["host.artifactTypes"]`); the per-type versions ride MyndHyve's
**top-level** `schemaVersions` handshake field (where `runEvent` / the universal
kinds already live — this host emits its `schemaVersions` map top-level, not
nested under `capabilities`):

```jsonc
{
  "capabilities": {
    "host.artifactTypes": {
      "supported": true,
      "store":  true,
      "render": true,
      "export": ["pdf", "pptx", "docx", "md", "png", "svg"]
    }
  },
  "schemaVersions": {
    // …runEvent, capabilities, clarification.request, schema.request,
    //    schema.response, error (universal kinds) …
    "vendor.myndhyve.prd": 1, "vendor.myndhyve.theme": 1, "vendor.myndhyve.plan": 1,
    "vendor.myndhyve.designSystem": 1, "vendor.myndhyve.kanban": 1, "vendor.myndhyve.code": 1,
    "vendor.myndhyve.document": 1,
    "vendor.myndhyve.presentationOutline": 1, "vendor.myndhyve.slideContent": 1, "vendor.myndhyve.presentationTheme": 1,
    "vendor.myndhyve.cadModel": 1, "vendor.myndhyve.bom": 1, "vendor.myndhyve.complianceReport": 1,
    "vendor.myndhyve.colorPalette": 1, "vendor.myndhyve.illustrationConcept": 1, "vendor.myndhyve.brushPreset": 1
  }
}
```

(16 `vendor.myndhyve.*` entries — curl-confirmed on the canary tag URL.)

## Conformance

Suite: run from the `openwop/openwop@feat/rfc-0071-artifact-card-packs` branch
(pre-publish); re-pin to the published `@openwop/openwop-conformance` minor once
it cuts. **4 files / 15 tests passed** against the canary tag URL, 2026-05-26.

| Scenario | Kind | Result |
|---|---|---|
| `artifact-type-pack-manifest-validation.test.ts` | server-free (host-agnostic) | PASS (6 tests) |
| `artifact-schema-compile-bounded.test.ts` | server-free floor | PASS (6 tests) |
| `artifact-type-pack-install.test.ts` | behavioral — `install`+`produce` seam | PASS (2 tests, was `host-pending`) — real HTTP round-trips (475ms / 352ms): a conforming payload yielded `artifact.created { registered: true }`; a schema-violating payload was rejected (not stored). |
| `artifact-type-store-without-render.test.ts` | behavioral — store-without-render negotiation | PASS (1 test, by soft-skip) — gated on `render:false`; MyndHyve advertises `render:true` (it has React viewers for every Canvas-Type artifact), so the scenario early-returns per its own guard. Honest posture, not a gap. |

## Migration map — status

The 16 `vendor.myndhyve.*` artifact types from the request's
[migration map](./0071-artifact-type-packs-migration-request.md#migration-map)
are advertised with `schemaVersion: 1`. The reverse-DNS rename lands on the
wire: MyndHyve's `CORE_ARTIFACT_TYPE_IDS` (`prd`/`theme`/`plan`/`screen`)
publish under `vendor.myndhyve.*` (`core.*` reserved for the working group);
bare legacy strings from external callers remain valid as the unregistered
first-class tier (`registered: false`).

## Honest scope — what is and isn't wired

Closing the gate via the documented seam is **Slice A**. Deliberately deferred
to **Slice B** (a follow-up slice, not a silent gap):

- Publishing the 5 signed `vendor.myndhyve.*` artifact-type pack tarballs
  (Ed25519 + SRI) to the registry. The conformance suite drives its own
  `vendor.conformance.note` sample pack through the seam, so the gate does not
  depend on MyndHyve's published packs — but real adoption does.
- Wiring the production binding path: `WorkflowNode.artifactType` + the
  validate-before-emit / `registered` stamp on the **live** `artifact.created`
  dispatch (today only the seam honors it). This is why the `host.artifactTypes`
  advertisement is conformance-deployment-gated rather than unconditional —
  advertising `supported:true` in production before the production path is
  wired would be advertise-vs-implement drift. Once Slice B ships, the
  advertisement goes unconditional.

## Records to land

_(Final-form lines below assume the traffic promote lands so the advertisement
serves the production endpoint; until then they read `canary-verified`.)_

**INTEROP-MATRIX.md** — add under a "RFC 0071 Phase 1 (MyndHyve)" section:

> | `workflow-runtime-00392-bug` | RFC 0071 Phase 1 artifact-type packs | `host.artifactTypes {supported,store,render,export}` + 16 `vendor.myndhyve.*` `schemaVersions` (curl-verified 2026-05-26) | `artifact-type-pack-install` + `artifact-type-store-without-render` (+ 2 server-free floors), 15 tests | Accepted ✅ |

**README.md** banner entry:

> MyndHyve graduated **RFC 0071 Phase 1 (artifact-type packs)** `Active → Accepted`
> on `workflow-runtime-00392-bug`, openwop-side curl-verified 2026-05-26 — first
> cross-host proof of the artifact-type surface; de-risks Phase 2 (chat card packs).

## References

- Request: [`0071-artifact-type-packs-migration-request.md`](./0071-artifact-type-packs-migration-request.md)
- RFC: [`../../RFCS/0071-artifact-type-and-chat-card-packs.md`](../../RFCS/0071-artifact-type-and-chat-card-packs.md)
- Spec: [`../../spec/v1/artifact-type-packs.md`](../../spec/v1/artifact-type-packs.md), [`../../spec/v1/host-capabilities.md`](../../spec/v1/host-capabilities.md) §host.artifactTypes
- PR: openwop/openwop#270
