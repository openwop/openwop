# RFC 0255 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The licence fails open and removes surfaces silently | M | H | High | §D gate changes with sabotage fixtures; the trial proved the current hole | Compatibility Architect | before `Active` | `mitigated` — §D gates built 2026-10-30, each proved red against the gate it replaced |
| R2 | A stored fenced run forks differently after the parser goes | L | M | Low | Census found none | Reference host | before host PR | `mitigated` — census 2026-10-30 |
| R3 | Security invariants lose their only test | H | H | High | §E tests land before the old scenarios go | Security Architect | spec PR | `mitigated` — every `a2ui-*` row has an `interrupt-form-*` successor with its own tests, landed 2026-10-30 while the old witnesses still run |
| R4 | A pack refusal removes `ai.research.web` from four agents | H | M | High | Publish pack versions before the suite | Reference host | before suite | `mitigated` — openwop-registry #103 (`f228326`) published brand, kanban and web-research 2.0.0 and yanked `vendor.myndhyve.ai`; no pack's newest non-yanked v2 version needs `aiEnvelope`, and `check-declaration` now fails one that does |
| R5 | A rolled-back revision runs teardown against a dropped table | M | M | Med | Keep table and cascades through the cut; drop in a later release | Reference host | table drop | `transferred:openwop-app-adr-1008` |
| R6 | An unnoticed stale reference survives green gates | H | L | Med | Tree-wide grep for each deleted name as an acceptance criterion | Spec Architect | spec PR | `mitigated` — the deletion PR's tree-wide grep for each deleted name; what remains is frozen v1, committed evidence, major-1 scenarios and v1 schemas |
| R7 | The no-outside-users statement is wrong | L | M | Low | Steward decision; the class closes when a tier-3 host appears | Steward | ongoing | `accepted` — steward decision 2026-10-30 |
