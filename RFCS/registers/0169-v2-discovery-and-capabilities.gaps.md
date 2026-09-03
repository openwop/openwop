# RFC 0169 — Gap register

Open design gaps discovered while authoring RFC 0169 (v2 discovery and capabilities; RFC 0167 child C.2). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | Unresolved Q1 | The `extensions.<org>.<name>` org form (short vs reverse-DNS). | Spec Architect | `open` — decided when the declaration file lands (Phase 3); recommended short form registered in the declaration file | RFC 0169 `Accepted` |
| G2 | §B.3 | `host-capabilities.md:2186` says a host MUST NOT advertise `host.workspace`; `agent-workspace.md:27` and `capabilities.schema.json:2979` make advertising it the gate for an Accepted surface (RFC 0059). A v1.x prose contradiction, out of this RFC's v2 scope. | Spec Architect | `open` — an editorial v1.x PR retracts the reserved-slot line citing RFC 0059; this row closes when it merges | — |
| G3 | §B.3 | `imageGeneration` / `videoGeneration` are prose-only under `aiProviders` (RFC 0105 G5); the gap's premise (`additionalProperties: false` on `aiProviders`) has drifted — the block is open at `capabilities.schema.json:1536`. Declared facets or deleted? | Spec Architect | `open` — decided in the C.10 child (RFC 0177) with RFC 0105; re-tokened `carried:` to that child's row when it is filed | RFC 0177 `Active` |
| G4 | §C.5 | The adoption-axis triage of RFCs 0112–0116 depends on Phase 4 bundle evidence that does not exist yet. | Conformance Architect | `open` — triaged at the cut from the Phase 4 bundles; until then every row is `single-witness` or `none` | RFC 0169 `Accepted` |
| G5 | §C.1 | `agent-platform-aggregate-evidence.test.ts:37` reads a root `profiles[]` that no schema declares (the RFC 0085 annex claim). The v2 suite reads the generated profile registry; the v1 scenario keeps reading the field until the v1 suite is archived. | Conformance Architect | `open` — the C.1 child (RFC 0168) retires the v1 read when suite 2.0.0 is cut; until then the field is tolerated by the open v1 root only | RFC 0168 `Active` |
