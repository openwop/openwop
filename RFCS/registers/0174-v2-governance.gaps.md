# RFC 0174 — Gap register

Open design gaps discovered while authoring RFC 0174 (v2 governance; RFC 0167 child C.7). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.3 | Numbers 0160–0162 were never authored (RFC 0158's renumber note). Filing `Withdrawn` stubs after the fact would be a paper trail for nothing. | Steward | `open` — left as recorded; the rule binds from RFC 0174 forward | — |
| G2 | §C.2 | 388 `carried:<self>` rows on terminal RFCs at filing (the RFC 0166 backfill default); 45 whose prose said CLOSED re-tokened here; 343 remain under the `selfCarried` ratchet. | Spec Architect | `open` — fall as registers are swept; a v2 RFC may not carry to itself | Phase 3 registers gate |
| G3 | §B.1 | `check-accepted-predicate.mjs` needs `gaps.json` rows bound to requirement ids, which none are today (RFC 0178 §B.1 owns the binding). | Conformance Architect | `open` — lands in Phase 3 with the C.1 suite; advisory report over the 158 v1 Accepted RFCs first (Unresolved Q1) | RFC 0174 `Accepted` |
| G4 | §E.3 | The 43 prose gap tables have two row shapes; the adapter into `gaps.json` must map both without inventing ids. | Spec Architect | `open` — Phase 3 with the `spec/v2/` move; ids are `(doc, row-order)` derived, never hand-minted | RFC 0174 `Accepted` |
