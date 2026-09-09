# RFC 0176 — Gap register

Open design gaps discovered while authoring RFC 0176 (v2 persisted data and coexistence; RFC 0167 child C.9). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.3 | Whether the atomic per-run backfill (stamp `3`, rewrite `type` under the same key, original preserved) is allowed in v2.0 or deferred to a later RFC. | Spec Architect | `open` — decided at Phase 3 with the reference host's era migration; recommended: allowed with the original preserved | RFC 0176 `Accepted` |
| G2 | §A.2 | MyndHyve advertises `eventLogSchemaVersion: 1` while its run documents stamp `2` and the spec says `2`; the unification is a host change this RFC requires before the codemap runs. | Reference-host maintainer (MyndHyve) | `externally-gated:myndhyve-phase-4-leg` — one constant, the run-document line, advertised for new runs | Phase 4 |
| G3 | §E.1 | The corpus-tag pin was recorded as a done Phase 0 item; the inventory finds 1 of 3 consumers pinned (openwop-app) — openwop-sdks tracks `main`, MyndHyve has no vendored corpus and a caret range, and the registry is unpinned and drifted (RFC 0177 §C.6). | Steward | `open` — openwop-sdks `CORPUS_TAG` in `check-vendored-sync.mjs`; MyndHyve exact-version pin; registry pin; the charter's Phase 0 row corrected | RFC 0176 `Accepted` |
| G4 | §C.1 | The charter chose per-major sub-objects in one document; this RFC chose header-selected representations (adversarial review 3). The charter's §C.9 text is amended at the next republish. | Steward | `closed` — decided here; the charter carries the deviation | — |
| G5 | §A.4 | openwop-app has 34 direct `storage.listEvents` call sites and a bypassed `eventLog.list` wrapper; the adapter seat is the interface method, and the scenario reads through poll, SSE and fork to catch a wrapper-only install. | Reference-host maintainer (openwop-app) | `externally-gated:openwop-app-phase-4-leg` — ADR names the seat | Phase 4 |
