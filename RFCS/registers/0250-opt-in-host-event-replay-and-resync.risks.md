# RFC 0250 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Cursor refusal reveals foreign event existence | M | H | High | §C byte-identical refusals; `0250.refusal-uniform` compares a second tenant's real cursor with an unknown one | Security Architect | at `Active` | `mitigated` — by `0250.refusal-uniform`. |
| R2 | Retention promise conflicts with privacy deletion | M | H | High | §D: lawful deletion, tenant removal and revoked visibility remove events from replay; nothing widens a view | Security Architect | at `Active` | `mitigated` — by §D. |
| R3 | Backlog/live handoff loses or reorders events | M | H | High | §B commit order and no-gap handoff; `0250.resume-backlog` emits a live marker after reconnecting | Spec + Conformance Architects | at `Active` | `mitigated` — by `0250.resume-backlog`. |
| R4 | A restart loses events but the cut reports pass | M | H | High | The suite cannot restart a host; a loss inside the window is a §B violation whenever a cut observes it. Disclosed in the falsifiability table | Conformance Architect | at `Active` | `accepted` — restart is not caused by the suite; the residual is disclosed, not hidden. |
| R5 | SDK loops on resync refusal or old host ignores query | M | M | Med | Advertise-first opt-in; non-retriable error; SDK regression cases (G5) | Compatibility Architect | before SDK rollout | `transferred:TODO.md` — the RFC 0250 line. |
