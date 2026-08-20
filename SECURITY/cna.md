# OpenWOP — CNA Registration

> **Status: planned, not yet active (2026-05-12).** Operational plan for becoming a CVE Numbering Authority (CNA). This document describes the path; CNA status itself is not yet claimed.

A CNA (CVE Numbering Authority) can assign CVE IDs for vulnerabilities in the scope it covers, without round-tripping through the MITRE root CNA. For an open-source protocol, becoming a CNA reduces disclosure friction — the maintainer set can publish CVEs on the same timeline as the patch, with consistent advisory metadata.

This is **not yet active.** The plan below documents what openwop intends to do once the prerequisites land. The actual CNA application is steward action gated on the same tripwire as the vendor-neutral org migration (≥1 non-steward maintainer in `MAINTAINERS.md`).

---

## Why CNA status

- **Disclosure cadence.** Today every openwop CVE goes through MITRE's `cve@mitre.org` queue with multi-day round-trips. As an industry-standard protocol with a growing implementation surface, that latency erodes coordinated-disclosure timing.
- **Scope clarity.** A CNA's scope statement is public. Implementers and downstream packagers know unambiguously what the openwop CNA does and does not coordinate on.
- **Cross-project coordination.** When a vulnerability spans the openwop protocol AND a third-party implementation, the openwop CNA can issue the spec-level CVE while the implementation issues its own — no double-attribution to MITRE.
- **Advisory provenance.** GitHub Security Advisories integrate cleanly with CNA-managed CVE IDs; reporters get a consistent advisory record without manual cross-linking.

---

## Scope (planned)

The openwop CNA, when registered, will cover:

- **In scope:**
  - The spec corpus (`spec/v1/`) — RFC 2119 violations that have a security implication (auth bypass, redaction failure, replay-attack vector).
  - The reference SDKs (`sdk/typescript/`, `sdk/python/`, `sdk/go/`) — exploitable defects in published SDK code.
  - The conformance harness (`conformance/`) — defects that mask host bugs.
  - The machine-readable contracts (`schemas/`, `api/openapi.yaml`, `api/asyncapi.yaml`) — schema bugs that enable injection or under-specification.
  - The reference example hosts (`examples/hosts/*`) — once they have non-steward users.

- **Out of scope:**
  - Third-party openwop-compatible servers, clients, or hosts. Each third-party impl is its own scope; their own CNA (or MITRE) handles those CVEs.
  - Host operational misconfigurations.
  - Vulnerabilities in upstream dependencies (Node, Python, Go, sqlite, postgres, wasm runtimes, etc.) — those have their own CNAs.
  - Vulnerabilities in the deployer's infrastructure (cloud config, network, TLS termination, KMS).

The scope statement above is the same as `SECURITY.md` §1. The CNA registration form will reference both for consistency.

---

## Prerequisites

1. **≥1 non-steward maintainer** listed in `MAINTAINERS.md`. CNA registration requires a maintainer group capable of independent decisions; a single-person CNA is allowed but discouraged because absence-of-maintainer freezes the disclosure pipeline.
2. **CVE Services account** registered with the CVE Program. The application form is at <https://www.cve.org/PartnerInformation/Partner/Apply> (no maintainer action until tripwire #1 fires).
3. **Disclosure SLA documented** in `SECURITY.md` §6 — already done (24h ack, 90-day embargo unless ≥CVSS 9.0).
4. **Advisory template** — landed at `SECURITY/advisory-template.md` (NOT YET — track here when this lands).
5. **CVE record schema** familiarity — the CNA uses the CVE Record Format v5.1+; we already publish enough metadata to populate every required field.

---

## Application process (after tripwire #1)

1. Lead maintainer (per `MAINTAINERS.md` §"Lead maintainer routing") submits the CNA application via <https://www.cve.org/PartnerInformation/Partner/Apply>.
2. CVE Program reviews; typical turnaround 4–8 weeks.
3. CNA agreement signed by the openwop project entity (currently the original OpenWOP working group; future maintainer-set may incorporate a vendor-neutral foundation).
4. Scope statement published at <https://www.cve.org/CNAs> (the public CNA directory).
5. `SECURITY.md` updated: §1 references the active CNA status; §6 references the new self-managed CVE pipeline alongside the existing GitHub Security Advisories path.

---

## Operational responsibilities (after CNA active)

- **CVE ID assignment.** Maintainer set assigns CVE IDs from the openwop CNA's annual allocation for in-scope vulnerabilities. ID range published per-year in `SECURITY/cve-allocations/<year>.md`.
- **Advisory publication.** Every assigned CVE has a corresponding advisory in `SECURITY/advisories/` AND in GitHub Security Advisories with the assigned CVE ID.
- **Annual scope review.** Maintainer set reviews the scope statement annually; widening or narrowing the scope follows the same RFC process as a spec change (per `GOVERNANCE.md`).
- **Downstream notification.** When openwop issues a CVE that affects shipped reference SDKs, the maintainer set notifies known third-party openwop-compatible host implementers via the channels listed in `MAINTAINERS.md` §"Coordinated disclosure".

---

## Until then

While the CNA isn't active, openwop continues using MITRE's CVE root for any vulnerability that warrants a CVE. The reporter is told this in the initial acknowledgment (per `SECURITY.md` §3 acknowledgment SLA); CVE assignment timing is therefore MITRE-dependent and may take days. The protocol's existing 24h ack + 90-day embargo SLA holds regardless of CVE timing.

For reporters and operators: nothing changes operationally before tripwire #1 fires. This document exists so the path is documented in advance — when the tripwire fires, the application is ready to file the same week.

---

## See also

- `SECURITY.md` — disclosure policy + reporting channels + response SLA
- `SECURITY/bug-bounty.md` — recognition-based coordinated-disclosure program (a paid program is tripwire-gated)
- `MAINTAINERS.md` — maintainer set + tripwire definition
- `ROADMAP.md` §"Vendor-neutral org migration" — the same tripwire gates the org migration; CNA registration is downstream of that decision
