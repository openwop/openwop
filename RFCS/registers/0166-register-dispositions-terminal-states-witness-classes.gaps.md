# RFC 0166 — Gap register

Open design gaps discovered while authoring RFC 0166 (register dispositions, terminal states, witness classes). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §C.2 | The initial witness classification of 191 invariants and 73 extensions is mechanical and marked `initial-mechanical-2026-09-02`. First review 2026-09-02 at `Accepted`: 25 invariants + 6 extension records re-judged, 10 reclassified `witnessable-gated → seam-gated`; 166 / 67 remain mechanical. | Security Architect | `carried:openwop.gap.0166.1` — the residual review continues per entry (flip the marker; a reclassification edits `witness`); the unreviewed ratchets in `docs/witness-baseline.json` can only fall; charter C.11 Phase 3 finishes the sweep before the v2 cut | done 2026-09-02 (this RFC's `Active → Accepted`) |
| G2 | §B | 543 gap entries carry `witness: unclassified`. | Spec Architect | `carried:openwop.gap.0166.2` — classify when a gap is next touched; the unclassified count is reported by `generate-gaps.mjs --check` as a ratchet; charter C.7 Phase 3 | — |
| G3 | §A.3 | 367 of the backfilled tokens were assigned by RFC-status default (`carried:<self>` on an Accepted RFC with no marker). They are correct under the README rule but not individually reviewed. | Spec Architect | `carried:openwop.gap.0166.3` — review opportunistically; a wrong `carried` is corrected by editing the token | — |
| G4 | §A.1 | `transferred:<target>` and `externally-gated:<tripwire>` arguments extracted from prose read `unspecified` where the text named no target. | Spec Architect | `carried:openwop.gap.0166.4` — fill in on the charter C.7 Phase 3 sweep | — |
| G5 | Unresolved Q1 | Whether `gaps.json` absorbs the 46 `spec/v1` "Open spec gaps" tables in v1.x. | Spec Architect | `carried:openwop.gap.0166.5` — charter C.7 Phase 3 item | — |
