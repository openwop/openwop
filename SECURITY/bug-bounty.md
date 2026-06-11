# OpenWOP — Bug-Bounty Program

> **Status: planned, not yet active (2026-05-12).** Operational plan for running a coordinated bug-bounty program for the openwop spec corpus + reference implementations. Same tripwire as CNA registration (`SECURITY/cna.md`): not active until `MAINTAINERS.md` lists ≥1 non-steward maintainer AND a maintaining org with budget for awards is in place.

A bug-bounty program rewards external researchers who find and responsibly disclose vulnerabilities. For an open-source protocol this is a high-leverage way to surface security defects that a small steward set wouldn't find on its own. This document defines the program structure; the actual budget + launch is gated on the prerequisites below.

---

## Why a bug-bounty program

- **Researcher incentive.** Security researchers operate on attention economics — programs that pay get triaged ahead of programs that don't. Even a small bounty ($500–$5000) materially improves disclosure quality + timing.
- **Pre-disclosure pipeline.** A bounty program creates a steady inflow of reports, including from researchers who would otherwise publish without coordinating. Coordinated disclosure plus an audit trail beats surprise GitHub issues.
- **Cost vs incident cost.** A single critical vulnerability disclosed via Twitter (uncoordinated) costs orders of magnitude more in remediation + reputation than a $5000 award through a program.
- **Adoption signal.** Production deployers evaluating openwop look for active security investment as a credibility signal. A documented bounty program is a strong one.

---

## Scope (planned, mirrors `SECURITY.md` §1)

- **In scope (eligible for awards):**
  - The spec corpus (`spec/v1/`) — exploitable RFC 2119 violations, auth bypass, redaction failure, replay-attack vectors, prompt-injection authority-bypass, BYOK leak vectors.
  - The reference SDKs (`sdk/typescript/`, `sdk/python/`, `sdk/go/`) — exploitable defects in published SDK code.
  - The conformance harness (`conformance/`) — defects that mask host bugs.
  - The machine-readable contracts (`schemas/`, `api/openapi.yaml`, `api/asyncapi.yaml`).
  - The reference example hosts (`examples/hosts/*`) — once they have non-steward users.

- **Out of scope (NOT eligible for awards):**
  - Third-party openwop-compatible servers, clients, or hosts. Report to their own programs.
  - Host operational misconfigurations (TLS, KMS, employee access).
  - Vulnerabilities in upstream dependencies (Node, Python, Go, sqlite, postgres, wasm runtimes).
  - Defects in protocol surfaces explicitly marked `DRAFT` / `OUTLINE` / `STUB` — those surfaces have no v1 conformance claim to defend.
  - Findings that require physical access, social engineering, or denial-of-service against shared infrastructure (`packs.openwop.dev`, `openwop.dev`).
  - Self-XSS / theoretical findings without a demonstrable attack path.

---

## Reward tiers (planned)

Pending budget commitment from the maintaining org. Indicative tiers:

| Severity                     | Criteria                                                                                               | Award range                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **Critical** (CVSS 9.0–10.0) | Remote code execution; full BYOK secret leak; arbitrary audit-log mutation; cross-tenant data exposure | $3000 – $10000               |
| **High** (CVSS 7.0–8.9)      | Auth bypass on a non-public surface; partial credential leak; replay-attack vector on signed callbacks | $1000 – $3000                |
| **Medium** (CVSS 4.0–6.9)    | Information disclosure of non-sensitive metadata; DoS on a single tenant; signing-key rotation flaw    | $250 – $1000                 |
| **Low** (CVSS 0.1–3.9)       | Spec ambiguity that enables a defect class but no demonstrable exploit; defense-in-depth weakening     | $50 – $250                   |
| **Informational**            | Quality reports with no exploit path; thoughtful suggestions                                           | $0 (acknowledgment + thanks) |

CVSS scoring uses CVSS v3.1 base score. Disputes resolved by the maintainer set + the reporter; severity reviews happen during the initial 24-hour acknowledgment window.

**Bonus considerations:**

- **+25%** for the first report of a vulnerability class (similar reports during embargo get the base award without the bonus).
- **+50%** for reports that include a proposed patch + a conformance scenario that would detect the regression.
- **+100%** for vulnerabilities that span the spec text AND a reference implementation AND the SDK (cross-cutting findings demonstrate unusually deep review).

---

## Rules of engagement

1. **Coordinated disclosure required.** Per `SECURITY.md` §3 + §4: 90-day embargo (24h for ≥CVSS 9.0). Public disclosure before embargo lifts forfeits the award.
2. **No automated scanning of shared infrastructure.** `packs.openwop.dev` and `openwop.dev` are intentionally low-budget hosting — scanner traffic destabilizes them for legitimate users. Reproduce findings locally against `examples/hosts/*` instead.
3. **No social engineering** of maintainers, contributors, or downstream operators.
4. **One report per vulnerability.** Splitting a single defect into multiple reports does not split the award.
5. **Patches MAY be authored** by the reporter. The maintainer set ultimately decides which patch lands; reporter-authored patches that ship get the +50% patch bonus.
6. **Awards taxable.** Recipients responsible for reporting awards per their local tax jurisdiction. The maintaining org issues 1099 / equivalent at year-end for awards ≥ $600 (US tax compliance).

---

## Prerequisites

1. **≥1 non-steward maintainer** in `MAINTAINERS.md` (same tripwire as CNA + vendor-neutral org migration).
2. **Maintaining org with budget** for awards. Anticipated: a vendor-neutral foundation post-migration. Initial budget target: $25k–$50k annually.
3. **Triage process** — landed at `SECURITY/triage-process.md` (NOT YET — track here when this lands; reuses the disclosure SLA from `SECURITY.md` §6).
4. **Award disbursement infrastructure** — typically a third-party platform (HackerOne, Bugcrowd, intigriti) or direct via the maintaining org's payment system. Decision deferred until the maintaining org is named.
5. **Advisory + CVE pipeline** wired (see `SECURITY/cna.md`). Bug-bounty findings often warrant CVEs; the CNA registration removes the MITRE round-trip.

---

## Until then

While the program isn't active, the disclosure policy in `SECURITY.md` still applies — researchers receive a 24h acknowledgment, a 90-day embargo (24h for critical), and public attribution in the resulting advisory. No monetary award until the program launches.

Reporters who find vulnerabilities in the openwop corpus right now are welcome to file under `SECURITY.md` §2. The eventual program will treat the historical reporters as charter contributors when a launch happens — meaningful acknowledgment, retroactive credits, and a path to monetary recognition if the program goes live with retroactive coverage.

---

## See also

- `SECURITY.md` — disclosure policy + reporting channels + response SLA
- `SECURITY/cna.md` — CNA registration plan (same tripwire)
- `MAINTAINERS.md` — maintainer set + tripwire definition
- `SECURITY/invariants.yaml` — what classes of vulnerabilities are protocol-tier MUST-NOTs
- `SECURITY/threat-model-*.md` — five published threat models
