# RFC 0166 — Gap register

Open design gaps discovered while authoring RFC 0166 (register dispositions, terminal states, witness classes). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §C.2 | The initial witness classification of 191 invariants and 73 extensions is mechanical and marked `initial-mechanical-2026-09-02`; none has been reviewed. | Security Architect | `open` review per entry, flipping the marker; the unreviewed ratchets in `docs/witness-baseline.json` measure progress | `Active → Accepted` (at least one reviewed per register) |
| G2 | §B | 538 gap entries carry `witness: unclassified`. | Spec Architect | `open` classify when a gap is next touched; the unclassified count is reported by `generate-gaps.mjs --check` as a ratchet | — |
| G3 | §A.3 | 367 of the backfilled tokens were assigned by RFC-status default (`carried:<self>` on an Accepted RFC with no marker). They are correct under the README rule but not individually reviewed. | Spec Architect | `open` review opportunistically; a wrong `carried` is corrected by editing the token | — |
| G4 | §A.1 | `transferred:<target>` and `externally-gated:<tripwire>` arguments extracted from prose read `unspecified` where the text named no target. | Spec Architect | `open` fill in on sweep | — |
| G5 | Unresolved Q1 | Whether `gaps.json` absorbs the 46 `spec/v1` "Open spec gaps" tables in v1.x. | Spec Architect | `carried:openwop.gap.0166.5` — charter C.7 Phase 3 item | — |
