# OpenWOP — Coordinated Disclosure & Security Recognition

> **Status: active (recognition-based, 2026-08-20).** OpenWOP runs a coordinated-disclosure program that rewards researchers with **acknowledgment, public credit, and advisory attribution — not money.** The project is steward-run and has **no bounty budget**; there are no monetary awards and no commitment to a paid program. This document defines how disclosure and recognition work today, and what a future paid program would require if the project is ever funded.

A coordinated-disclosure program surfaces security defects a small steward set wouldn't find on its own. For an open-source protocol, the higher-leverage half of that is not the payout — it is the *pipeline*: a clear channel, a fast acknowledgment, a real embargo, and durable public credit for the people who report responsibly. OpenWOP offers all of that now. It does not offer money, and this file is deliberate about not implying otherwise.

---

## What reporters get today

- **Acknowledgment within 24 hours** of a report filed per `SECURITY.md` §2.
- **A coordinated embargo** — 90 days, or 24 hours for CVSS ≥ 9.0 — per `SECURITY.md` §3 + §4.
- **Public attribution** in the resulting advisory, unless the reporter asks to stay anonymous.
- **Charter-contributor credit.** Reporters who find real vulnerabilities during this pre-funding period are recorded as charter security contributors. If a funded, monetary program is ever launched with retroactive coverage, these reporters are first in line for recognition under it.

There is **no monetary award.** A report's value is recognized in credit and attribution, not payment.

---

## Scope (mirrors `SECURITY.md` §1)

- **In scope:**
  - The spec corpus (`spec/v1/`) — exploitable RFC 2119 violations, auth bypass, redaction failure, replay-attack vectors, prompt-injection authority-bypass, BYOK leak vectors.
  - The reference SDKs (in [`openwop-sdks`](https://github.com/openwop/openwop-sdks)) — exploitable defects in published SDK code.
  - The conformance harness (`conformance/`) — defects that mask host bugs.
  - The machine-readable contracts (`schemas/`, `api/openapi.yaml`, `api/asyncapi.yaml`).
  - The reference example hosts (in [`openwop-examples`](https://github.com/openwop/openwop-examples)) — once they have non-steward users.

- **Out of scope:**
  - Third-party openwop-compatible servers, clients, or hosts. Report to their own programs.
  - Host operational misconfigurations (TLS, KMS, employee access).
  - Vulnerabilities in upstream dependencies (Node, Python, Go, sqlite, postgres, wasm runtimes).
  - Defects in protocol surfaces explicitly marked `DRAFT` / `OUTLINE` / `STUB` — those surfaces have no v1 conformance claim to defend.
  - Findings that require physical access, social engineering, or denial-of-service against shared infrastructure (`packs.openwop.dev`, `openwop.dev`).
  - Self-XSS / theoretical findings without a demonstrable attack path.

---

## Rules of engagement

1. **Coordinated disclosure required.** Per `SECURITY.md` §3 + §4: 90-day embargo (24h for ≥ CVSS 9.0). Public disclosure before the embargo lifts forfeits attribution credit.
2. **No automated scanning of shared infrastructure.** `packs.openwop.dev` and `openwop.dev` are intentionally low-budget hosting — scanner traffic destabilizes them for legitimate users. Reproduce findings locally against the reference example hosts instead.
3. **No social engineering** of maintainers, contributors, or downstream operators.
4. **One report per vulnerability.** Splitting a single defect into multiple reports does not multiply the credit.
5. **Patches are welcome.** The maintainer set decides which patch lands; a reporter-authored patch that ships — especially one paired with a conformance scenario that would catch the regression — earns the fullest form of credit this program offers.

Severity is assessed with CVSS v3.1 during the initial 24-hour acknowledgment window, and disputes are resolved between the maintainer set and the reporter. Severity here drives disclosure urgency and advisory framing — not a payout.

---

## If the project is ever funded

A monetary program is **not planned or committed** — it is contingent on the project acquiring an entity that could responsibly run one. That would require **all** of:

1. **≥ 1 non-steward maintainer** in `MAINTAINERS.md` (the same tripwire as CNA registration and the vendor-neutral-org migration).
2. **A maintaining organization with a dedicated security budget** — anticipated only as a vendor-neutral foundation post-migration.
3. **A triage process** (`SECURITY/triage-process.md`), reusing the disclosure SLA from `SECURITY.md` §6.
4. **Award-disbursement infrastructure** — a third-party platform (HackerOne, Bugcrowd, intigriti) or the maintaining org's own payment system, with the attendant tax handling.
5. **An advisory + CVE pipeline** wired (see `SECURITY/cna.md`).

Until every one of those exists, this program stays recognition-based. Reporters are welcome to file vulnerabilities in the openwop corpus right now under `SECURITY.md` §2.

---

## See also

- `SECURITY.md` — disclosure policy + reporting channels + response SLA
- `SECURITY/cna.md` — CNA registration plan (same tripwire as a future paid program)
- `MAINTAINERS.md` — maintainer set + tripwire definition
- `SECURITY/invariants.yaml` — what classes of vulnerabilities are protocol-tier MUST-NOTs
- `SECURITY/threat-model-*.md` — five published threat models
