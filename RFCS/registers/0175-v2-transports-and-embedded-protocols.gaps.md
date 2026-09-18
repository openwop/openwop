# RFC 0175 — Gap register

Open design gaps discovered while authoring RFC 0175 (v2 transports and embedded protocols; RFC 0167 child C.8). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §D.4 | The 90-day refresh SLA is the shortest window both upstreams' lifecycle policies exceed; it has not been measured against an actual upstream release cadence. | Spec Architect | `transferred:ROADMAP.md#implementation-ecosystem` — re-measured at the first upstream refresh, recorded on the `a2a`/`mcp` extension records (2026-09-17). Was: re-measured at the first refresh after the cut; recorded on the extension records for `a2a`/`mcp` | RFC 0175 `Accepted` |
| G2 | §D.1 | Authenticated negotiation and the floor are witnessed only through the C.1 seams profile (the wire toward a peer is unobservable from the host's own API); the `negotiation.decided` event is the normative surface. | Conformance Architect | `closed` — `seam-gated` for the peer-capture legs and `witnessable-gated` for the event leg, recorded in each scenario and `conformance/requirements.json` (2026-09-17). Was: `seam-gated` for the peer-capture legs, `witnessable-gated` for the event leg; recorded as such in the falsifiability table | RFC 0168 `Active` |
| G3 | §A.1 | Whether a Phase 3 contributor generates the proto from the declaration file and lands a suite client (the named door back into core). | Steward | `externally-gated:grpc-client-contributor` — no work is scheduled; the extension stays `adoption: none` until one exists | — |
| G4 | Unresolved Q1 | Whether `negotiation.decided` carries the peer origin in clear or as a digest. | Security Architect | `closed` — `negotiationDecided` carries `peerDigest`, not the origin in clear (2026-09-17). Was: recommended digest; decided with `SECURITY/threat-model-interop.md` in Phase 3 | RFC 0175 `Accepted` |
