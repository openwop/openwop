# RFC 0265 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host maps the reserved effect to a node it does not record on the effect ledger, so leg 3 reads zero and fails a host that compensates correctly. | M | M | Med | §A makes the mapping a MUST for a host that serves the fixture, and the scenario reports `blocked`, not `fail`, when the forward effects are absent from the ledger too. | Conformance Architect | at `Active` | `transferred:RFC 0265 Acceptance criteria` 2026-11-13 — the scenario box carries the blocked-vs-fail split. |
| R2 | The legs pass on a host that compensates only this fixture. | L | M | Low | A conformance fixture shows the host CAN unwind under the rules; it never proved general behavior for any family. Bundles say what ran. | Conformance Architect | at `Active` | `accepted` 2026-11-13 |
