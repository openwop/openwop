# SECURITY

> **Status: current.** Vulnerability-disclosure policy for the OpenWOP protocol, its machine-readable contracts, the conformance suite, the SDKs and the example hosts. The protocol's normative security requirements are in [`spec/v2/core/security-defaults.md`](./spec/v2/core/security-defaults.md), [`identity.md`](./spec/v2/core/identity.md), [`idempotency.md`](./spec/v2/core/idempotency.md), [`webhooks.md`](./spec/v2/core/webhooks.md) and the per-capability documents. This file covers the disclosure process, response times, embargo terms and advisory tracking.

Threat models for specific surfaces live under [`SECURITY/`](./SECURITY/); see §8.

## 1. Scope

This policy covers vulnerabilities in:

- The v2 specification: [`spec/v2/`](./spec/v2/).
- The machine-readable contracts: [`schemas/v2/`](./schemas/v2/), [`api/v2/`](./api/v2/) and `api/seams-v2.yaml`, as published in `@openwop/spec-artifacts`.
- The conformance suite: [`conformance/`](./conformance/) (`@openwop/openwop-conformance`).
- The SDKs in [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks) and the example hosts in [`openwop/openwop-examples`](https://github.com/openwop/openwop-examples). Report those here too; one policy covers all three repositories.

**v1.** v1 reached end of support on 2026-10-04 ([RFC 0234](./RFCS/0234-maintainer-set-v1-end-of-support.md)), and its tree (`spec/v1/`, the flat `schemas/*.schema.json`, `api/openapi.yaml`, `api/asyncapi.yaml`) is frozen. Hosts may still serve v1, so a v1 vulnerability is still worth reporting. Expect the fix to land in v2 and the v1 side to be handled by an advisory that names a mitigation, not by edits to the frozen tree.

Out of scope:

- Vulnerabilities in third-party OpenWOP servers, clients or hosts. Report those to that project's security contact. The maintainer set MAY coordinate cross-project disclosure when a vulnerability spans the spec and a third-party implementation.
- Implementation choices outside the spec's normative requirements. "My host accepts a malformed request" is the host's bug; "the spec requires accepting a malformed request" is a spec bug.

## 2. Reporting channels

### 2.1 Preferred — GitHub Security Advisories

File a private advisory at <https://github.com/openwop/openwop/security/advisories/new>. GitHub provides an embargoed working space for coordinated disclosure, CVE coordination and downstream notification.

### 2.2 Active exploitation

If the vulnerability is being actively exploited, file a GitHub Security Advisory with the subject prefix `[ACTIVE EXPLOIT]`. The maintainer set is paged within the times in §3.

### 2.3 Do not file public issues

Do not file public issues for vulnerabilities. The public issue tracker is not embargoed and will leak the report to anyone watching the repository.

## 3. Response SLA

The maintainer set commits to:

| Phase                                                                                                      | Target                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Acknowledgment of receipt                                                                                  | **3 business days**                                                             |
| Initial triage (severity assessment, scope confirmation, "we'll fix" / "out of scope" / "needs more info") | **10 business days**                                                            |
| Remediation timeline communication                                                                         | **20 business days** from triage                                                |
| Coordinated disclosure (per §4)                                                                            | **90 days** from initial report unless reporter and maintainers agree to extend |

The SLA applies to good-faith reports from any reporter. The maintainer set MAY decline to engage with spam, automated scanner output without a proof of concept, or known false positives, with a brief explanation to the reporter.

If the SLA cannot be met because the maintainer set is too small or under unusual load, the reporter is notified before the deadline with a revised timeline.

**This table is the project's single security-response commitment** (RFC 0147 §I). Its numbers come from `SECURITY/response-sla.json`, and `scripts/check-doc-tallies.mjs` fails if this table or `GOVERNANCE.md` §Security drifts from that file. `GOVERNANCE.md` and `MAINTAINERS.md` defer to it. The maintainer set is currently one person (`MAINTAINERS.md`); the revised-timeline clause above says what happens when a firm target held by one person slips. It does not lower the target.

## 4. Coordinated disclosure

The default is **90-day coordinated disclosure** from the initial report.

- Reporters SHOULD allow at least 90 days before publishing details.
- Maintainers SHOULD ship a fix or a coordinated public advisory within the 90-day window.
- If the fix requires a `COMPATIBILITY.md` §3 safety-fix break, the embargo MAY extend by up to another 90 days while implementers operating production deployments prepare to migrate. The extension is announced to the reporter and to known affected implementers.
- The reporter and maintainers MAY agree on a shorter or longer window for a specific case (for example, 30 days when only an SDK patch is needed).
- If the maintainer set fails to acknowledge or engage within the §3 SLA, the reporter MAY shorten the embargo. Public disclosure under this clause SHOULD note that maintainer engagement was the reason.

## 5. CVE coordination

The maintainer set requests CVE IDs through:

- **GitHub Security Advisories.** GitHub is a CVE Numbering Authority (CNA) for projects it hosts; an advisory filed via §2.1 can request a CVE through the GitHub UI.
- **MITRE direct submission**, when a GitHub-issued CVE isn't appropriate (for example, when the vulnerability spans GitHub-hosted and external code).

The maintainer set is not its own CNA. Registering as one waits until `MAINTAINERS.md` lists a maintainer outside the steward's organization; the plan and scope are in [`SECURITY/cna.md`](./SECURITY/cna.md).

OpenWOP runs a **recognition-based** disclosure program: acknowledgment, public credit and advisory attribution, with no monetary awards. Its scope and rules are in [`SECURITY/bug-bounty.md`](./SECURITY/bug-bounty.md). A paid program is not committed; it would need the same maintainer condition and a funded maintaining organization.

## 6. Advisory tracking

### 6.1 Identifiers

Every confirmed vulnerability is assigned an `openwop-SA-YYYY-NNNN` identifier on triage:

- `YYYY` is the year of triage.
- `NNNN` is a sequential number starting at `0001` each year.

The identifier is used in CHANGELOG entries, CVE submissions and downstream notification.

### 6.2 Public record

Patched releases cite the advisory ID in `CHANGELOG.md` under a `### Security` heading. A consolidated index of past advisories will live at `SECURITY/advisories.md`, created when the first advisory is resolved. Its absence does not imply there have been no reports.

### 6.3 What's published

For each resolved advisory, the public record includes:

- Advisory ID and CVE ID (if assigned).
- Affected versions.
- Fixed versions.
- Severity (CVSS v3.1 base score).
- A brief description of the impact.
- Credit to the reporter, with their consent (anonymous credit is the default without explicit consent).
- Links to the patch commits and any migration tooling.

What's not published:

- Full proof-of-concept exploits.
- Reporter identifying information without consent.
- Internal investigation timelines beyond the public dates.

## 7. Safe harbor

The maintainer set commits not to pursue legal action against good-faith security researchers who:

- Make a good-faith effort to follow this policy.
- Avoid privacy violations, destruction of data and disruption of production services during research.
- Don't exploit the vulnerability beyond what's needed to demonstrate it.
- Don't extort or threaten the project or its users.

This commitment binds the maintainer set. It does not bind third-party OpenWOP hosts; researchers testing those should follow the third party's own disclosure policy.

## 8. Threat model references

Each threat model covers one attack surface. The invariant counts below are the rows in `SECURITY/invariants.yaml` whose `threat_model:` field points at that file.

| Threat model | Covers | Invariants |
| --- | --- | --- |
| [`threat-model-secret-leakage.md`](./SECURITY/threat-model-secret-leakage.md) | BYOK secret resolution and redaction: credential references, memory attribution, workspace, sub-run attestation, egress policy | 94 |
| [`threat-model-prompt-injection.md`](./SECURITY/threat-model-prompt-injection.md) | LLM-mediated workflows: indirect injection via artifacts, exfiltration via tool output, feedback-path manipulation, A2A/MCP peer authority | 49 |
| [`threat-model-node-packs.md`](./SECURITY/threat-model-node-packs.md) | Node-pack supply chain: tampering, signature substitution, sandbox escape | 30 |
| [`threat-model-provider-policy.md`](./SECURITY/threat-model-provider-policy.md) | Provider-policy bypass across all four modes | 15 |
| [`threat-model-auth-profiles.md`](./SECURITY/threat-model-auth-profiles.md) | OAuth2 client credentials, OIDC user bearer, mTLS and API-key rotation | 13 |
| [`threat-model-workload-identity.md`](./SECURITY/threat-model-workload-identity.md) | Workload identity, delegated actor chain, sender constraint, content-free audit, artifact provenance (RFC 0154) | 9 |
| [`threat-model-interop.md`](./SECURITY/threat-model-interop.md) | A2A and MCP in both directions: version negotiation, drift, content crossing the peer boundary | 5 |
| [`threat-model-compensation.md`](./SECURITY/threat-model-compensation.md) | Compensation and partial failure: plans, inverse actions, approvals, dead letters, operator recovery (RFC 0151) | 5 |
| [`threat-model-replay.md`](./SECURITY/threat-model-replay.md) | Replay and fork: recorded-fact re-emission, side-effect suppression, host-initiated fan-out | 4 |

The threat models track invariants in `SECURITY/invariants.yaml` (224 rows as of 2026-10-06: 187 protocol-tier, 35 reference-impl-tier, 2 advisory).

`scripts/check-security-invariants.sh` (step 6 of the 10-step `npm run openwop:check`) verifies that:

- every protocol-tier MUST NOT maps to at least one matching conformance test; and
- every row's `threat_model:` pointer resolves to a file that exists.

Whether that file actually **names** the invariant is a ratchet: 78 rows point at a document that never mentions them. The baseline is in the script; it may not grow, and the gate asks you to lower it when you trace one.

Reference-impl-tier invariants are verified by the reference hosts' own CI. Advisory invariants are defense in depth and don't gate.

**What the gate does and does not say (RFC 0148 §A).** The mapping proves a scenario *exists* for an invariant, not that it ran non-vacuously against a given host. A scenario gated on a capability the host doesn't advertise records `inapplicable`; one whose seam the host hasn't wired records `blocked`. Per-host execution evidence is the host's certification bundle (`INTEROP-MATRIX.md`), not this gate.

## 9. External audit

No external security review has been engaged. No vendor has been contacted and no review has run. The engagement plan is [`SECURITY/external-audit-engagement.md`](./SECURITY/external-audit-engagement.md), and per-vendor outreach state is in [`SECURITY/outreach/external-audit/STATUS.md`](./SECURITY/outreach/external-audit/STATUS.md). The plan's scope was written against v1 and must be re-cut for v2 before outreach is sent.

Until a review completes, RFC 0147 §A bans the phrases "industry standard" and "independently validated" from the corpus. RFC 0147 §I makes a completed audit, with every Critical and High finding remediated, a standards-readiness gate.

The findings ledger [`SECURITY/external-audit-findings.json`](./SECURITY/external-audit-findings.json) is committed empty (`findings: []`) because no review has run. `scripts/check-audit-findings.mjs` gates it: once findings exist, no open High or Critical finding may remain at standardization. The steward's own pre-audit pass is [`SECURITY/internal-pre-audit-summary.md`](./SECURITY/internal-pre-audit-summary.md); it is not an external review.

External audit findings are published as advisories under §6 once remediation has shipped.

## 10. Amendments

Changes to this document follow `GOVERNANCE.md` §"Spec change process":

- Editorial changes (typos, link fixes, contact updates): a PR with one maintainer approval.
- Substantive changes to the disclosure process or SLA: an RFC per `RFCS/0001-rfc-process.md`.

When the SLA is missed in a way that suggests the commitment is unrealistic, the maintainer set files an RFC to revise it rather than keep missing the target.

## 11. References

- [`spec/v2/core/security-defaults.md`](./spec/v2/core/security-defaults.md) — the obligation table of mandatory security defaults, relaxations and onward hops.
- [`spec/v2/core/identity.md`](./spec/v2/core/identity.md) — subjects, credential binding on every lane, resume tokens, identifier grammars and identity error codes.
- [`spec/v2/core/idempotency.md`](./spec/v2/core/idempotency.md) — idempotent run creation and tenant isolation.
- [`spec/v2/core/webhooks.md`](./spec/v2/core/webhooks.md) — webhook delivery integrity (signing, replay prevention, SSRF protection).
- `COMPATIBILITY.md` §3 — the safety-fix exception for security-driven breaks within a major.
- `RFCS/0001-rfc-process.md` — the RFC mechanism used for substantive amendments.
- `MAINTAINERS.md` — the maintainer set who receive disclosures.
- `GOVERNANCE.md` — broader governance context.
