# OpenWOP Spec v1 — Self-hosted Runner

> **Status: Stable · v1.x (2026-07-02) — RFC 0122 `Accepted` (2026-07-02; graduated 2026-09-03 under RFC 0174 §D.1).** Normative surface for [RFC 0122 — Self-hosted runner (remote-driven local execution)](../../RFCS/0122-self-hosted-runner-remote-execution.md): a host routes a run's per-step model/tool dispatch to a user-controlled **runner** that dials OUT to the host and holds local credentials the host cannot reach. Companion to [`capabilities.md`](./capabilities.md) (`selfHostedRunner`), [`stream-modes.md`](./stream-modes.md) (the SSE framing + `Last-Event-ID` resume this reuses), [`replay.md`](./replay.md) (per-step persistence + fork), and the BYOK/credential surface of RFC 0046/0108/0121. **RFC 0122 is `Accepted`: hosts MAY advertise `selfHostedRunner.supported: true` (`RFCS/README.md` records the graduation); an earlier revision of this banner forbade it after the RFC had already graduated.** Keywords MUST, SHOULD, MAY, MUST NOT, SHOULD NOT follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

## Why this exists

Two Accepted surfaces establish the pieces but stop at a boundary a hosted control
plane cannot cross. [RFC 0108](../../RFCS/0108-self-hosted-openai-compatible-provider-class.md)
lets a host dispatch to an operator-configured endpoint — but only one the *host*
can reach; a multi-tenant cloud host cannot reach a *user's* loopback endpoint.
[RFC 0121](../../RFCS/0121-subscription-provider-auth.md) lets a run use a personal
subscription — but only via a client the executing process can run; on a stateless
cloud host there is no such client and no user login.

The missing primitive is **execution locality**: a way for the executing side to be
a user-controlled runner that dials the host, so the host orchestrates while the
*runner* holds the credential and does the work — the same shape as CI self-hosted
runners. The cleanest mental model: **today's co-located loopback shim is the
degenerate case of a runner** — "a runner on localhost the host can POST to
directly." A remote runner is the same per-step dispatch unit with the connection
direction flipped: the runner dials OUT, so the user's machine needs no inbound
network exposure.

The channel is the right thing to specify because runner↔host is a wire contract
two independent implementations must interoperate over (framing, dispatch routing,
result delivery, liveness, runner-to-host auth), and because advertising it is a
capability handshake other clients must discover.

## Roles

- **Host** — the control plane (MAY be multi-tenant/cloud). Owns run identity,
  persistence, replay, and the client-facing API. Holds **no** runner credential
  material.
- **Runner** — a user-controlled process (a laptop, a `clients/` daemon, a desktop
  app) that authenticates to the host, then receives dispatch work over a persistent
  channel and returns results. Holds the local credentials (subscription CLI login,
  private endpoint). Bound to exactly **one** owning subject (the RFC 0048 principal).

## Registration + channel

### Runner-to-host authentication

A runner opens a persistent connection to the host and authenticates with a
**host-minted, subject-scoped runner bearer** — a revocable, non-provider token the
host issues for the owning subject. The host records a `SelfHostedRunnerRegistration`
([`self-hosted-runner-registration.schema.json`](../../schemas/self-hosted-runner-registration.schema.json)):
`{ runnerId, subject, capabilities }`, where `subject` is the stable RFC 0048
principal the host stamps on the backing run's `run.metadata` (NOT a fresh id). The
runner bearer MUST NOT be a provider credential; compromise of the host MUST NOT
yield any provider credential (§Trust boundary).

### The channel (SSE outbound + POST result)

OpenWOP has no WebSocket transport; the runner↔host channel reuses the existing SSE
framing and invents no new wire shape:

- **Receive (dispatch).** The runner opens a long-lived **`GET` (SSE)** stream to the
  host and receives `SelfHostedRunnerDispatchFrame`
  ([schema](../../schemas/self-hosted-runner-dispatch-frame.schema.json)) frames using
  the canonical `event:`/`data:`/`id:` framing of [`stream-modes.md`](./stream-modes.md).
  The channel is runner-initiated (outbound), so the runner needs **no inbound network
  exposure**.
- **Return (result).** The runner POSTs a `SelfHostedRunnerResultFrame`
  ([schema](../../schemas/self-hosted-runner-result-frame.schema.json)) back to the host
  over ordinary HTTP for each dispatch it completes.

### The dispatch cursor + resume

Each dispatch frame carries a **per-runner monotonic dispatch cursor** `seq`. This
cursor is a **DISTINCT sequence from the run event-log `sequence`** and the two MUST
NOT be conflated — reusing the event-log sequence (e.g. an ETag-from-seq derivation)
breaks resume dedup, because dispatch to a given runner is not 1:1 with event-log
advancement. A reconnecting runner resumes by sending `Last-Event-ID` set to the last
dispatch cursor it processed; the host resumes delivery after that cursor per
[`stream-modes.md §Resumption`](./stream-modes.md#resumption).

### At-most-once dispatch

`Last-Event-ID` resume alone is insufficient, because a runner side effect (a
subscription-CLI turn = real spend; a tool action) is **not itself idempotent**.
Therefore, beyond the runner cursor, the **host MUST drop — not re-dispatch — any
`{runId, stepId}` whose result is already persisted**. The `{runId, stepId}` pair is
the at-most-once idempotency key; a runner MUST return its result under the same pair
it received.

## Behavior (normative)

1. **Subject isolation.** A host MUST NOT route a run's dispatch to a runner not owned
   by the run's subject. When addressing by capability-match (any free runner for the
   step's provider/model/tool), the host MUST filter on `subject` **FIRST, then
   capability** — never the reverse — so a capability match can never route a
   subject's step to another subject's runner (subject-first match — a normative MUST
   verified by the gated `self-hosted-runner` conformance scenario).
2. **Credential non-transit.** A runner credential (subscription login, endpoint key)
   MUST NOT transit the host, and MUST NOT appear in any dispatch frame, result frame,
   run event, run result, debug bundle, or log. The host sends `inputs`, receives
   `output`, and never sees the credential (`runner-credential-non-transit`; mirrors
   the BYOK SR-1 rule).
3. **Untrusted transport.** A host MUST treat a runner as untrusted transport:
   runner-returned `output` re-entering an agent loop MUST be fenced as untrusted
   (`<UNTRUSTED>`), consistent with the existing tool-output fencing requirement
   (`runner-output-untrusted-transport`).
4. **Per-step granularity.** A host routes only individual model/tool **dispatch
   steps**, never a whole run. The host remains the sole orchestration/persistence/
   replay authority; the runner is a stateless dispatch executor. A dispatch frame
   carries one step (`{ runId, stepId, seq, kind, … , inputs }`); the result frame
   carries that step's `{ runId, stepId, seq, output }`. A host MAY route only a
   subset of dispatch kinds (advertised via `selfHostedRunner.dispatchKinds`) — e.g.
   `model` first, `tool` later behind the same gate.
5. **Liveness.** A dispatch routed to a runner that has gone away MUST fail with a
   distinct, **retriable** error `runner_unavailable`, and MUST NOT hang
   indefinitely.
6. **Truthful advertisement.** A host MUST NOT advertise
   `selfHostedRunner.supported: true` unless it honors this channel (accepts
   registrations, routes matching dispatch, delivers results). A dishonest claim is
   non-conformant and MUST fail `OPENWOP_REQUIRE_BEHAVIOR=true`. Because RFC 0122 is
   `Accepted` (2026-07-02): hosts MAY advertise the capability; this line said the opposite until the RFC 0174 §D.1 sweep (2026-09-03).

## Trust boundary + replay

- **Auth.** Runner↔host auth is a host-minted, subject-scoped bearer — revocable,
  non-provider. Compromise of the host does not yield provider credentials.
- **Outbound-only.** The runner channel is runner-initiated; the user's machine
  needs no inbound exposure.
- **Replay reads persistence; never re-dispatches.** Each dispatch result is persisted
  as a normal step record. On `POST /v1/runs/{runId}:fork` (replay), the host reads the
  persisted step output and MUST NOT re-dispatch to the runner — so replay is
  deterministic even if the original runner is long gone
  ([`replay.md`](./replay.md)).
- **Fork re-routes; no runner pin.** A fork of a run whose steps executed on a now-
  absent runner re-routes *future* (post-fork) dispatch to any runner owned by the
  run's subject with a matching capability; it MUST NOT pin to the original `runnerId`.
- **ToS posture out of scope.** What the runner *does* (e.g. driving a subscription
  CLI) is the runner operator's at-own-risk decision (RFC 0121); this doc governs only
  the host↔runner contract.

## Capability

Advertised as the OPTIONAL root block `selfHostedRunner` on `GET /.well-known/openwop`
([`capabilities.md §selfHostedRunner`](./capabilities.md), modeled on the RFC 0073
document-root layout beside `agents`/`connections`/`a2a`):

```json
"selfHostedRunner": { "supported": true, "dispatchKinds": ["model"] }
```

`supported` is REQUIRED when the block is present; `dispatchKinds` is OPTIONAL. The
per-subject `SelfHostedRunnerRegistration` record is runtime state and MUST NOT appear
on `/.well-known/openwop`.

## Examples

**Positive.** A hosted control plane advertises `selfHostedRunner`; a user's desktop
app registers a runner for subject `user_42` with `capabilities.providers: ["anthropic"]`.
The user, from a phone, starts a run whose model step is an `anthropic` `subscription`
provider (RFC 0121). The host matches a free runner owned by `user_42`, sends a
`model` dispatch frame `{runId, stepId, seq, provider:"anthropic", model, inputs}`, the
runner runs `claude -p` under the user's local login and POSTs back
`{runId, stepId, seq, output}`. The host persists and streams the completion. The
subscription token never left the laptop.

**Negative (rejected) — cross-subject routing.** A host attempts to match subject A's
step to subject B's runner. MUST be refused (subject-first match — behavior §1).

**Negative (rejected) — credential on the wire.** A runner attaches a credential field
to a result frame. The host MUST strip/reject it; the credential MUST NOT be persisted
or logged (`runner-credential-non-transit`, `additionalProperties:false` on the frame).

**Liveness.** The user closes the laptop mid-run. The next dispatch fails with retriable
`runner_unavailable`; the run does not hang. On a later fork, future dispatch re-routes
to any runner `user_42` has registered — persisted steps replay from persistence.

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 4 row(s) this table carried are now `openwop.gap.spec.self-hosted-runner.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- [RFC 0122 — Self-hosted runner (remote-driven local execution)](../../RFCS/0122-self-hosted-runner-remote-execution.md)
- [`capabilities.md`](./capabilities.md) — the `selfHostedRunner` advertisement
- [`stream-modes.md`](./stream-modes.md) — SSE framing + `Last-Event-ID` resumption
- [`replay.md`](./replay.md) — per-step persistence + `:fork`
- [RFC 0108](../../RFCS/0108-self-hosted-openai-compatible-provider-class.md) · [RFC 0121](../../RFCS/0121-subscription-provider-auth.md) · [RFC 0048](../../RFCS/0048-tenant-workspace-principal-identity-model.md)
- Schemas: [`self-hosted-runner-dispatch-frame.schema.json`](../../schemas/self-hosted-runner-dispatch-frame.schema.json) · [`self-hosted-runner-result-frame.schema.json`](../../schemas/self-hosted-runner-result-frame.schema.json) · [`self-hosted-runner-registration.schema.json`](../../schemas/self-hosted-runner-registration.schema.json)
