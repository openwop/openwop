# RFC 0237 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host lists a source and still draws it again on a `replay` fork, so a forked run diverges from its source. | M | M | Med | §B makes reproduction a MUST; the fork-equality leg fails a host that draws again. | Conformance Architect | `accepted` — the leg is the control; until it ships the obligation is the same as today's unfalsifiable rule, no worse. |
| R2 | The `env` source pushes host configuration into recorded state, where it could carry secret material. | L | H | Med | `env` values are recorded like any run state, so SR-1 redaction applies; a host never lists a secret-bearing value as `env`. The Active change states it. | Security Architect | `accepted` — SR-1 already binds recorded run state. |
| R3 | The closed vocabulary misses a source a host draws, and the host reaches for `x-*`, which no suite can test. | M | L | Low | `x-*` is the declared escape; a common one becomes a vocabulary entry by a later RFC. | Spec Architect | `accepted` — an untested vendor source is honest, not hidden. |
