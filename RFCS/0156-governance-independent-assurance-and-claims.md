# RFC 0156: Governance, Independent Assurance, and Claims Policy

| Field | Value |
| --- | --- |
| **RFC** | 0156 |
| **Title** | Governance, Independent Assurance, and Claims Policy |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** RFC text and its gap/risk registers. **Carried forward, not closed:** cross-organization governance, the external audit, Tier-3 evidence, and machine-gated claims — all externally gated.) |
| **Affects** | `GOVERNANCE.md`, `MAINTAINERS.md`, `SECURITY.md`, `CONTRIBUTING.md`, `COMPATIBILITY.md`, `ROADMAP.md`, `INTEROP-MATRIX.md`, RFC 0038, release and claim tooling |
| **Compatibility** | Governance/process change; no host wire break |
| **Supersedes** | Bootstrap single-steward waiver practice once activation conditions are met |
| **Superseded by** | — |

## Summary

This RFC makes OpenWOP's vendor-neutrality, security assurance, and public claims evidence-based. It retires bootstrap waivers, activates cross-organization governance, requires retrospective review of high-risk waived RFCs, completes an independent security audit, and requires a Tier-3 host before “industry standard,” “independently validated,” or equivalent claims. A generated assurance manifest keeps those claims current rather than permanently earned.

## Motivation

OpenWOP currently has one maintainer, no Tier-3 host, an unstarted external audit, and a waiver ledger whose credibility tripwire has been crossed. Tier-2 affiliated evidence is useful but not independent. The corpus cannot credibly grade itself A or call itself a vendor-neutral industry standard solely from steward-authored RFCs, steward-operated hosts, and internally maintained conformance.

## Proposal

### §A — Maintainer and decision transition

Before this RFC becomes Active, at least two maintainers unaffiliated with the original steward **MUST** accept nomination and publish affiliations/conflicts. RFC 0038's working-group charter **MUST** activate. High-risk normative changes **MUST** receive two approvals from different organizations and the full public comment window. The original steward may participate and retain one vote but **MUST NOT** unilaterally waive these requirements.

### §B — Bootstrap waiver retirement and retrospective review

The bootstrap comment-window and DCO practice exemptions **MUST** retire on activation. A generated ledger **MUST** enumerate accepted RFCs that used a waiver. RFCs affecting auth, identity, tenant isolation, secrets, packs, execution sandboxing, idempotency, replay, external effects, conformance/certification, or governance **MUST** receive retrospective cross-organization review. Review outcomes are `ratified|corrective-rfc-required|provisional|withdrawn`; silence **MUST NOT** mean ratified.

### §C — Independent security assurance

An external security firm with no financial or governance control by the steward **MUST** review the scoped protocol, conformance runner, machine contracts, official reference implementations, and release provenance. A public summary **MUST** state scope, dates, methodology, severity counts, excluded surfaces, and retest status. All Critical/High findings **MUST** be remediated and retested before an industry-standard claim. Medium findings require owner, target date, and residual-risk statement.

Audit status values are `not-started|contracted|in-progress|remediation|retest|complete`; an empty findings file **MUST NOT** be represented as a completed clean audit.

### §D — Tier-3 implementation evidence

At least one organization unaffiliated with the steward **MUST** independently control its repository, architecture, release decisions, deployment, and evidence publication. Funding or technical assistance is permitted but **MUST** be disclosed. Tier-3 qualification requires:

- corrected RFC 0148 bundle v2 for `openwop-core-standard`;
- no blocked requirement in the claimed floor;
- one current A2A 1.0 or MCP 2026-07-28 real-peer profile;
- publication of host commit, deployment identity, suite/corpus provenance, configuration digest, and limitations; and
- independent signoff that the steward could not modify the result unilaterally.

### §E — Claims policy

The following claims are gated:

| Claim | Required current evidence |
| --- | --- |
| `OpenWOP conformant` | RFC 0155 core-standard profile plus RFC 0148 bundle v2 |
| `current A2A compatible` | RFC 0152 A2A 1.0 real-peer result |
| `current MCP compatible` | RFC 0153 current-profile real-peer result |
| `production multi-region` | RFC 0150 fenced-effects partition/failover evidence |
| `independently validated` | completed external audit and Tier-3 result |
| `vendor-neutral industry standard` | cross-org governance, completed audit, and Tier-3 result |
| `best-in-class durable orchestration` | effect-safety plus RFC 0151 compensation production evidence |

A claim **MUST** be withdrawn or qualified when evidence expires, a critical regression opens, the audit is no longer current, or the only Tier-3 result ceases to be reproducible.

### §F — Assurance manifest

Publish generated `docs/ASSURANCE-STATUS.json` and a human-readable projection containing governance membership/affiliations, waiver-review counts, audit status/retest date, Tier-3 evidence, current suite/corpus versions, open Critical/High risks, and permitted claims. Inputs **MUST** link to immutable evidence. CI **MUST** fail if README/site claim tokens exceed the manifest's permitted claims.

### §G — Operational commitments

`SECURITY.md`, `GOVERNANCE.md`, and `MAINTAINERS.md` **MUST** share one generated security-response SLA source. The project **MUST** publish an annual governance review, annual independent security review or justified risk-based cadence, quarterly standards-version review, and release-by-release conformance evidence refresh.

## Compatibility

No host wire contract changes. Governance and public-claim requirements become operational at Active. Existing protocol versions remain valid, but unsupported marketing/README/site claims must be qualified. Retrospective review corrections follow their own compatibility classification; this RFC does not authorize bypassing `COMPATIBILITY.md`.

## Conformance

This process RFC uses repository-policy checks rather than host behavior scenarios:

- `assurance-status-valid.test.ts`;
- `claims-evidence-gate.test.ts`;
- `audit-state-honesty.test.ts`;
- `waiver-ratification-ledger.test.ts`;
- `maintainer-affiliation-quorum.test.ts`; and
- `tier3-evidence-bundle.test.ts`.

Tests are server-free and always-on. The Tier-3 bundle is verified with RFC 0148 logic. Fixtures cover not-started empty audit, expired evidence, affiliated-host mislabeling, missing cross-org approval, and disallowed claim text.

## Alternatives considered

1. Keep bootstrap rules until organic growth occurs. Rejected: the tripwire is already crossed and continued waivers deepen the credibility gap.
2. Treat MyndHyve as independent. Rejected: governance explicitly classifies it Tier 2 affiliated.
3. Allow self-audit plus bug bounty. Rejected: useful controls, not independent assurance.
4. Make claims advisory only. Rejected: unsupported claims are a standards integrity defect.
5. Do nothing. Rejected: vendor neutrality remains aspirational rather than evidenced.

## Unresolved questions

1. Who are the first two independent maintainer candidates?
2. Which audit vendor, budget, scope, and contract date are approved?
3. Which RFCs enter the retrospective high-risk cohort?
4. Which organization is the first Tier-3 candidate?
5. What evidence-expiry periods apply to audit, interop, and conformance results?
6. Which public sites/repos are scanned by the claims gate?

## Implementation notes (non-normative)

This RFC depends on external decisions and should remain Draft until named candidates and audit funding exist. It is SR-9 under RFC 0147. The work cannot be declared complete by repository changes alone.

## Acceptance criteria

- [ ] Two independent maintainers appointed and RFC 0038 activated.
- [ ] Bootstrap waivers retired and high-risk retrospective ledger resolved.
- [ ] External audit completed; Critical/High findings remediated and retested.
- [ ] Tier-3 host publishes valid core-standard v2 evidence plus one current interop profile.
- [ ] Assurance manifest and claims CI gate land across public surfaces.
- [ ] Security SLA source and recurring review cadence are operational.
- [ ] Governance, security, contributing, compatibility, roadmap, matrix, status, and CHANGELOG documents agree.

## References

- RFCs 0038, 0147 Workstreams 8–9, 0148, and 0155
- `GOVERNANCE.md`, `MAINTAINERS.md`, `SECURITY.md`
- `SECURITY/external-audit-engagement.md`
- `INTEROP-MATRIX.md` evidence tiers
- NIST AI RMF and OWASP Agentic AI threats and mitigations

