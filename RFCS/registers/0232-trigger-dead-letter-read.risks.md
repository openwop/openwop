# RFC 0232 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A record carries the inbound body or a header, turning a diagnostic read into a payload-replay surface for anyone with `webhooks:manage`. | L | H | Med | §C.1 forbids it, and the leg-4 path posts a canary and fails a record that carries it. The record holds the events' own payloads, which are already content-free. | Security Architect | `accepted` — the scenario row is the control; it ships with `Active`. |
| R2 | A host lists another tenant's dead letters through a guessed subscription id. | L | H | Med | §B.2 binds the id to the tenant and answers a foreign id like an unknown one; a §E row checks it with a second tenant's credential. | Security Architect | `accepted` — the same rule and witness as the webhook read (RFC 0188). |
| R3 | Decision G1(a) is read as an exemption from the floor by another name. | M | M | Med | It records `inapplicable` only for a condition no party can cause, with the reason on the row, and the RFC says so in Unresolved question 1 for the maintainer to decide. | Conformance Architect | `accepted` — decided in the window, before `Active`. |
