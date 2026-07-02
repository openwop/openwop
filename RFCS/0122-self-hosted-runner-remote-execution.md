# RFC 0122: Self-hosted runner (remote-driven local execution)

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0122                                                            |
| **Title**         | Self-hosted runner (remote-driven local execution)              |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (openwop-app maintainer)                            |
| **Created**       | 2026-07-02                                                      |
| **Updated**       | 2026-07-02                                                      |
| **Affects**       | new spec doc `spec/v1/self-hosted-runner.md`; `capabilities.md` (a new advertised capability); conformance (a new gated scenario); potentially SDK client types |
| **Compatibility** | `additive`                                                      |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

> **Status note.** This is a **Draft** authored to open the design; it is NOT yet
> `Accepted`. No host may advertise the capability until this reaches `Accepted`
> per `capabilities.md`. It exists to unblock design discussion for the deferred
> Phase 5 of openwop-app ADR 0182 (self-hosted subscription-CLI execution driven
> from a remote/hosted server).

## Summary

Define an OPTIONAL capability by which a **host** (orchestration/control plane)
routes a run's model-dispatch — or a whole run — to a **runner**: a
user-controlled process (e.g. a laptop, a `clients/` daemon, a desktop app) that
connects OUT to the host over a persistent channel and executes on the user's
own machine. This lets a hosted control plane use compute and credentials that
exist only on the user's machine (a locally-logged-in vendor CLI, a private
model endpoint) without the host ever holding those credentials, and lets the
user drive that local execution from anywhere (including a phone).

## Motivation

Two accepted surfaces already establish the pieces but stop at the boundary a
hosted control plane cannot cross:

- **RFC 0108 (self-hosted / compat provider)** lets a host dispatch to an
  operator-configured endpoint — but only one the *host* can reach. A hosted
  (multi-tenant, cloud) control plane cannot reach a *user's* loopback endpoint.
- **RFC 0121 (subscription provider auth)** allows using a personal
  subscription — but only via a client the executing process can run. On a
  stateless cloud host there is no such client and no user login.

The missing primitive is **execution locality**: a way for the executing side to
be a user-controlled runner that dials the host, so the host orchestrates while
the *runner* holds the credential and does the work. This is the same shape as
CI self-hosted runners. openwop-app ADR 0182 can serve subscription auth today
only when the backend is co-located with the CLI (self-hosted, same machine);
this RFC is what a *hosted* deployment needs to offer the same thing safely.

Spec is the right layer because the runner↔host channel is a wire contract two
independent implementations must interoperate over (framing, run routing, result
delivery, liveness, auth of the runner to the host), and because advertising it
is a capability handshake other clients must discover.

## Proposal

A new OPTIONAL capability `selfHostedRunner`, discoverable via
`/.well-known/openwop`, plus a runner-registration + run-routing channel.

### Roles

- **Host** — the control plane (may be multi-tenant/cloud). Owns run identity,
  persistence, and the client-facing API. Holds NO runner credential material.
- **Runner** — a user-controlled process that authenticates to the host, then
  receives dispatch/execution work over a persistent channel and returns
  results. Holds the local credentials (subscription CLI login, private
  endpoint). Bound to exactly one owning subject (RFC 0048 principal).

### Registration + channel (sketch — to be specified in `self-hosted-runner.md`)

- The runner opens a persistent connection to the host and authenticates with a
  **runner-scoped bearer** minted by the host for the owning subject (never a
  provider credential). The host records `{ runnerId, subject, capabilities }`.
- The channel MUST be runner-initiated (outbound), so the runner needs no
  inbound network exposure — the loopback-only safety property of ADR 0182's
  shim is preserved end-to-end.
- Work is addressed to a runner by `runnerId` (direct) or by capability match
  (any free runner for the subject). Result frames carry the `runId` they
  answer.

### Behavior (normative highlights — RFC 2119)

- A host MUST NOT route a run to a runner not owned by the run's subject
  (tenant/principal isolation across the channel).
- A runner credential (subscription login, endpoint key) MUST NOT transit the
  host or appear in any run event, result, or log (mirrors the BYOK SR-1
  invariant; the host only ever sees model *outputs*).
- A host MUST treat a runner as untrusted transport: runner-returned content
  re-entering an agent loop MUST be fenced as untrusted (consistent with the
  existing tool-output fencing requirement).
- Liveness: a run routed to a runner that goes away MUST fail with a
  distinct, retriable error (`runner_unavailable`), never hang indefinitely.
- Advertising `selfHostedRunner` without honoring the channel MUST fail
  `OPENWOP_REQUIRE_BEHAVIOR=true` (honest-advertisement rule).

### Examples

Positive: a hosted control plane advertises `selfHostedRunner`; a user's desktop
app registers a runner; the user (from a phone) starts a run whose model step is
a `subscription` provider; the host routes the dispatch to the runner, which runs
`claude -p` under the user's login and returns the completion; the host persists
and streams it. The subscription token never left the laptop.

Negative (rejected): a host routes subject A's run to subject B's runner →
MUST be refused (isolation). A runner attempts to attach a credential to a result
frame → the host MUST strip/reject it.

## Security & privacy

- Runner↔host auth is a host-minted, subject-scoped bearer — revocable,
  non-provider. Compromise of the host does not yield provider credentials.
- Outbound-only runner channel: no inbound exposure of the user's machine.
- Untrusted-transport treatment of runner output (injection defense).
- The ToS posture of *what the runner does* (e.g. driving a subscription CLI) is
  out of scope here and remains the runner operator's at-own-risk decision (RFC
  0121); this RFC governs only the host↔runner contract.

## Alternatives considered

- **Host-reachable endpoint only (RFC 0108 as-is):** cannot reach a user's
  loopback from a cloud host — the exact gap this closes.
- **Ship credentials to the host:** rejected — violates the credential-custody
  invariant and the whole point of execution locality.
- **No spec (host-private):** two hosts/runners could not interoperate; a
  desktop runner would be locked to one host. The channel is a wire contract.

## Open questions

1. Channel transport: reuse an existing streaming transport (SSE/WebSocket) or
   define a dedicated framing? Interaction with the A2A surfaces (RFC 0100/0101)?
2. Granularity: route whole runs, or only individual model/tool dispatch steps?
   (Per-step keeps host-side orchestration/replay authoritative.)
3. Replay/fork: a run partly executed on a now-absent runner — does it fork on
   the host with a re-route, or pin to the original runner?
4. Runner capability schema (which providers/models/tools it can serve).

## Adoption / conformance

A new gated conformance scenario asserting isolation (no cross-subject routing),
credential non-transit, and `runner_unavailable` on liveness loss. Reference-host
work (openwop-app ADR 0182 Phase 5) proceeds only once this reaches `Accepted`.
