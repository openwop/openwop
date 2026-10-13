# RFC 0243 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host advertising `auth.subjectLinkKey` without both linking lanes measures non-conformant on the first suite that ships §B. | L | L | Low | No host's live advertisement does so (openwop-app dropped the key; read 2026-10-12). Committed bundles stay valid at their own suite (COMPATIBILITY.md §2.3) and are reported, not re-judged. | Spec Architect | `accepted` — measured by suite release. |
| R2 | A host that refuses the fixture at load reads as `inapplicable`, the same as one that never seeded it, so a correct refusal earns no pass. | H | L | Low | Recorded as unwitnessable from outside (Falsifiability row §A.2 at load). The `createRun` fallback is the witnessed path; a host wanting the row loads the fixture and refuses at `createRun`. | Conformance Architect | `accepted` — by construction. |
| R3 | A v1 implementer reads `capabilities.dispatch.*` and advertises it at v2. | M | L | Low | The closed `agents` record rejects it at the schema (`recordSchemaLeg`), and the `dispatch-config` / `orchestrator-decision` descriptions name `agents.fanOut`. | Spec Architect | `mitigated` — schema-rejected. |
