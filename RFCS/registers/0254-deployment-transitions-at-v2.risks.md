# RFC 0254 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A `promote` skips `test` or `staged`, bypassing the eval or approval gate attached there | M | H | High | §A: one step per `promote`; a skip is `409 deployment_state_conflict`; `0082.promote-skip-refused` | Security Architect | at `Active` | `mitigated` — by §A and its leg, sabotage-proved on a scratch host. |
| R2 | The management run exposes deployment events to another tenant | L | H | Med | §D: the run is an ordinary tenant-scoped run, read with `runs:read` in the same tenant | Security Architect | at `Active` | `mitigated` — by the run reads' existing tenant rule (`identity.md` §5). |
| R3 | A `deployment.*` payload carries manifest or prompt content once readable | L | H | Med | The payload schemas are closed and content-free; `0082.transition-event-recorded` validates each recorded payload | Security Architect | at `Active` | `mitigated` — by the closed payload schemas and the leg. |
| R4 | Tightened legs fail a host that implemented the looser v1 reading | L | M | Low | No host advertises `agents.deployment` today; the legacy MyndHyve runtime retired 2026-10-29 | Conformance Architect | at `Active` | `accepted` — no host is affected. |
