# RFC 0177 — Gap register

Open design gaps discovered while authoring RFC 0177 (v2 registry, packs, and the extension tail; RFC 0167 child C.10). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.2 | Whether `registry/v2/` carries steward re-signs of `core.openwop.*` / `vendor.openwop*` or only author re-publications. | Steward | `open` — recommended: steward re-signs for the two steward namespaces; vendor cohorts re-publish themselves in Phase 4 | RFC 0177 `Accepted` |
| G2 | §B.2 | The alias table cannot be generated until `spec/v2/declaration.json` exists (RFC 0169, Phase 3); the seven guaranteed rows are known from the inventory. | Spec Architect | `open` — first generation is a dry run of `check-declaration.mjs` over the 282 manifests in the RFC 0169 Phase 3 PR | RFC 0177 `Accepted` |
| G3 | §F | The two non-canonical publication paths (MyndHyve `PUT /v1/packs/…`, the mirror ingest) apply §A.1 only when the host leg lands. | Reference-host maintainer (MyndHyve) | `externally-gated:myndhyve-phase-4-leg` | Phase 4 |
| G4 | §E.3 | The portable `{{params.*}}` deferral (WCP4): expansion materializes `parameters` into workflow `variables[]` and rewrites `{{params.x}}` into a PromptTemplate `{{varName}}` with `source: "variable"`, gated behind a capability with replay determinism for the run-scoped bag. Not in v2.0. | Spec Architect | `open` — a v2.x additive RFC; owner named; the recipe recorded here so the gap table can retire | — |
| G5 | §C.6 | The registry's vendored `node-pack-manifest.schema.json` lacks the RFC 0138 hatch (drifted, unpinned) — the registry rejects the field the protocol requires; 7 of 13 vendored schemas drift from the corpus. | Steward | `open` — pinned and re-synced in the registry PR that adds `registry/v2/`; closed by RFC 0176 G3's registry leg | RFC 0177 `Accepted` |
