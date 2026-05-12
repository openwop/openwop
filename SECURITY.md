# SECURITY

> **Status: v1 (2026-05-01).** Vulnerability-disclosure policy for the openwop protocol, reference implementations, conformance suite, and machine-readable contracts. The protocol's normative security requirements are specified in `auth.md`, `idempotency.md`, `webhooks.md`, and per-capability spec docs; this file covers the disclosure process, response SLA, embargo terms, and advisory tracking.

Profile-specific threat models live under `SECURITY/`, including `threat-model-auth-profiles.md`, `threat-model-secret-leakage.md`, `threat-model-provider-policy.md`, `threat-model-node-packs.md`, and `threat-model-prompt-injection.md`.

## 1. Scope

This policy covers vulnerabilities in:

- The spec corpus (`spec/v1/`).
- The reference SDKs (`sdk/{typescript,python,go}/`).
- The conformance harness (`conformance/`).
- The machine-readable contracts (`schemas/`, `api/openapi.yaml`, `api/asyncapi.yaml`).
- The example reference hosts (`examples/hosts/`) once they ship.

Out of scope:

- Vulnerabilities in third-party openwop-compatible servers, clients, or hosts. Report those to the respective project's security contact. The maintainer set MAY coordinate cross-project disclosure when a vulnerability spans the spec and a third-party implementation.
- Implementation choices a host makes that are outside the spec's normative requirements. "My host accepts a malformed request" is the host's bug; "the spec requires accepting a malformed request" is a spec bug.

## 2. Reporting channels

### 2.1 Preferred — GitHub Security Advisories

File a private advisory at https://github.com/openwop/openwop/security/advisories/new. GitHub provides an embargoed working space for coordinated disclosure, CVE coordination, and downstream notification.

### 2.2 Email fallback — `security@openwop.ai`

For reporters who can't or prefer not to use GitHub Security Advisories. The email is monitored by the maintainer set listed in `MAINTAINERS.md`.

### 2.3 Active exploitation

If the vulnerability is being actively exploited, file via either channel with subject prefix `[ACTIVE EXPLOIT]`. The maintainer set is paged within the SLA in §3.

### 2.4 Do not file public issues

Do not file public issues for vulnerabilities. The public issue tracker is not embargoed and will leak the report to anyone watching the repository.

## 3. Response SLA

The maintainer set commits to:

| Phase | Target |
|---|---|
| Acknowledgment of receipt | **3 business days** |
| Initial triage (severity assessment, scope confirmation, "we'll fix" / "out of scope" / "needs more info") | **10 business days** |
| Remediation timeline communication | **20 business days** from triage |
| Coordinated disclosure (per §4) | **90 days** from initial report unless reporter and maintainers agree to extend |

The SLA applies to good-faith reports from any reporter. The maintainer set MAY decline to engage with reports that are spam, automated scanner output without proof-of-concept, or known false positives, with a brief explanation to the reporter.

If the SLA cannot be met because the maintainer set is too small or under unusual load, the reporter is notified before the deadline with a revised timeline.

## 4. Coordinated disclosure

The default is **90-day coordinated disclosure** from initial report.

- Reporters SHOULD allow at least 90 days before publishing details.
- Maintainers SHOULD ship a fix or coordinated public advisory within the 90-day window.
- If the fix requires a `COMPATIBILITY.md` §3 safety-fix break, the embargo MAY extend up to an additional 90 days while implementers operating production deployments prepare migration. The extension is announced to the reporter and to known affected implementers.
- The reporter and maintainers MAY agree on a shorter or longer window for specific cases (e.g., if remediation requires only an SDK patch, the window may be 30 days).
- If the maintainer set fails to acknowledge or engage within the §3 SLA, the reporter MAY shorten the embargo to expedite public disclosure. Public disclosure under this clause SHOULD include a brief note that maintainer engagement was the reason.

## 5. CVE coordination

The maintainer set will request CVE IDs through:

- **GitHub Security Advisories** — GitHub is a CVE Numbering Authority (CNA) for projects hosted on GitHub; advisories filed via §2.1 can request a CVE through the GitHub UI.
- **MITRE direct submission** — for cases where GitHub-issued CVEs aren't appropriate (e.g., the vulnerability spans GitHub-hosted and external code).

The maintainer set does not currently operate as its own CNA. CNA registration is planned and tripwire-gated on `MAINTAINERS.md` listing ≥1 non-steward maintainer; the operational plan + scope statement is at `SECURITY/cna.md`. A coordinated bug-bounty program is planned on the same tripwire; structure + reward tiers are at `SECURITY/bug-bounty.md`.

## 6. Advisory tracking

### 6.1 Identifiers

Every confirmed vulnerability is assigned a `openwop-SA-YYYY-NNNN` identifier on triage:

- `YYYY` is the year of triage.
- `NNNN` is a sequential number starting at `0001` per year.

The identifier is used in CHANGELOG entries, CVE submissions, and downstream notification.

### 6.2 Public record

Patched releases reference the advisory ID in `CHANGELOG.md` under a `### Security` heading. A consolidated index of past advisories lives at `security/advisories.md` once the first advisory is resolved (the file is created at first need; absence does not imply zero advisories).

### 6.3 What's published

For each resolved advisory, the public record includes:

- Advisory ID and CVE ID (if assigned).
- Affected versions.
- Fixed versions.
- Severity (CVSS v3.1 base score).
- Brief description of the impact.
- Credit to the reporter (with their consent; anonymous credit is the default if consent isn't explicit).
- Links to the patch commits and any required migration tooling.

What's NOT published:

- Full proof-of-concept exploits.
- Reporter identifying information without consent.
- Internal investigation timelines beyond the public-facing dates.

## 7. Safe harbor

The maintainer set commits to not pursue legal action against good-faith security researchers who:

- Make a good-faith effort to follow this disclosure policy.
- Avoid privacy violations, destruction of data, and disruption of production services during research.
- Don't exploit the vulnerability beyond what's necessary to demonstrate it.
- Don't extort or threaten the project or its users.

This safe-harbor commitment binds the maintainer set; it does not bind third-party openwop-compatible hosts. Researchers reporting vulnerabilities in third-party hosts should review the third party's separate disclosure policy.

## 8. Threat model references

openwop threat models live at `SECURITY/threat-model-*.md` and cover specific attack surfaces:

- `SECURITY/threat-model-secret-leakage.md` — BYOK secret resolution and redaction invariants (T1–T5 trust boundaries; 12 invariants).
- `SECURITY/threat-model-prompt-injection.md` — LLM-mediated workflows (indirect injection via artifacts, exfiltration via tool outputs, refine-feedback path manipulation; 13 invariants).
- `SECURITY/threat-model-node-packs.md` — node-pack supply chain (tampering, signature substitution, sandbox escape; 25 invariants).
- `SECURITY/threat-model-provider-policy.md` — provider-policy bypass paths across all four modes; 13 invariants.

The threat models track invariants in `SECURITY/invariants.yaml`; the CI gate at `scripts/check-security-invariants.sh` (step 8 of `openwop-check.sh`) verifies every protocol-tier MUST-NOT maps to at least one matching conformance test. Reference-impl-tier invariants are verified by the reference impl's CI; advisory invariants are defense-in-depth and don't gate.

## 9. External audit

The project intends to commission an external security review before making any "industry standard" claim per `the public security review plan`. The engagement plan lives at [`SECURITY/external-audit-engagement.md`](./SECURITY/external-audit-engagement.md) (drafted 2026-05-10, vendor selection pending). Scope, deliverables, embargo terms, budget range, and the engagement status tracker live in that document.

External audit findings are published as advisories under §6 once remediation has shipped.

## 10. Amendments

Changes to this document follow `GOVERNANCE.md` §"Spec change process":

- Editorial changes (typos, link fixes, contact updates) — direct PR with one maintainer approval.
- Substantive changes to the disclosure process or SLA — file an RFC per `RFCS/0001-rfc-process.md`.

When the SLA is missed in a way that suggests the documented commitment is unrealistic, the maintainer set proactively files an RFC to revise it rather than continuing to miss the documented target.

## 11. References

- `auth.md` — normative auth/authorization model, bearer-token format, 401/403 error envelope.
- `idempotency.md` — idempotent run creation, tenant isolation.
- `webhooks.md` — webhook delivery integrity (HMAC signing, replay prevention).
- `COMPATIBILITY.md` §3 — safety-fix exception that gates security-driven v1.x breaks.
- `RFCS/0001-rfc-process.md` — formal RFC mechanism used for substantive amendments.
- `MAINTAINERS.md` — maintainer set who receive disclosures.
- `GOVERNANCE.md` — broader governance context.
