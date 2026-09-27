# RFC 0220 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A reader takes a reservation's `Stable` label to mean two hosts interoperate on it. | M | M | Med | `ext/README.md` states per witness class what the label means; each reservation's §Conformance says it in its own words. | Spec Architect | `accepted` — mitigated in prose; G2 is the real fix. |
| R2 | A host advertises an empty `{}` record to graduate a family it does not serve. | L | M | Low | A claims-check cannot see behavior, by definition. The tier-2 bar limits who can graduate a family, and a tier-2 host's claims are reviewed at promotion (the 7-day window). | Governance | `accepted` |
| R3 | `host-tiers.json` drifts from `GOVERNANCE.md`, e.g. a host is re-tiered in prose only. | L | M | Low | Each row cites the governance line; an unlisted origin never qualifies, so drift fails closed. | Governance | `accepted` |
