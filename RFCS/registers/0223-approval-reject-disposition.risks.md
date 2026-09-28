# RFC 0223 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A workflow authored against v1's "a reject loops the run back" behaviour, with no failure-admitting edge, now ends `failed` at v2 where it used to continue. | L | M | Low | v1's loop-back applied to the RFC 0051 gate node, whose workflows carried the edge; the v2 hosts already fail the run. Authors add an `any_failed` or `all_complete` edge. | Spec Architect | `accepted` — the rule matches what every v2 host does today. |
| R2 | A host keeps emitting its old unregistered code, and clients routing on `error` miss the reject. | M | M | Med | overview.md §0 already forbids it; `0223.reject-fails-run` fails the host until it renames. | Conformance Architect | `mitigated` — the scenario witnesses it. |
