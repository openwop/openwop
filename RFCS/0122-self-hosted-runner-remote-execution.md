# RFC 0122: Self-hosted runner (remote-driven local execution)

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0122                                                            |
| **Title**         | Self-hosted runner (remote-driven local execution)              |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (openwop-app maintainer)                            |
| **Created**       | 2026-07-02                                                      |
| **Updated**       | 2026-07-02 — Active → Accepted (dual-witness graduation vs conformance suite `1.48.0`: openwop-app reference host + MyndHyve tier-2 witness both pass the gated `self-hosted-runner` scenario non-vacuously behind the capability gate; see [Status history](#status-history)). The wire surface (`selfHostedRunner` capability + dispatch/result/registration frame schemas + 2 protocol-tier SECURITY invariants + gated conformance scenario) is implemented and reflected in the corpus; hosts MAY now advertise `selfHostedRunner`. |
| **Affects**       | new spec doc `spec/v1/self-hosted-runner.md`; `capabilities.md` (a new advertised capability); conformance (a new gated scenario); potentially SDK client types |
| **Compatibility** | `additive`                                                      |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

> **Status note.** This is `Accepted` (2026-07-02) — the wire surface is
> implemented and reflected in the corpus, and the gated `self-hosted-runner`
> conformance scenario was witnessed **non-vacuously** on two hosts (openwop-app
> reference + MyndHyve tier-2) vs suite `1.48.0` (see [Status history](#status-history)).
> **Hosts MAY now advertise the `selfHostedRunner` capability and claim it in
> `INTEROP-MATRIX.md`** once they pass the gated scenario honestly. The
> credential-non-transit and output-untrusted-transport safety rails
> (`runner-credential-non-transit`, `runner-output-untrusted-transport`) are
> protocol-tier SECURITY invariants verified at the spec gate.

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

Resolved at `Active` (architect-reviewed 2026-07-02, cross-reviewed by both
reference-host teams — openwop-app ADR 0182 Phase 5 + a myndhyve second arm — each
of whom ran it through their own architecture review; wire-shape locked). Each
resolution below is normative for the forthcoming `spec/v1/self-hosted-runner.md`.

1. **Channel transport — RESOLVED: reuse SSE.** OpenWOP has no WebSocket transport;
   the only persistent wire shape is SSE (`stream-modes.md`) plus the A2A durable
   `{taskId↔runId}` record (`a2a-task-state.schema.json`). The runner dials OUT: a
   long-lived **GET (SSE) to receive dispatch frames**, ordinary **POST to return
   result frames** — no inbound network exposure of the runner's machine
   (preserving the ADR 0182 loopback-only property end-to-end). Each dispatch frame
   MUST carry a **per-runner monotonic dispatch cursor** that is a **distinct
   sequence from the run event-log `sequence`** (they MUST NOT be conflated — reusing
   the event-log seq, e.g. the RFC 0115 `Capabilities-Etag`-from-seq derivation,
   breaks resume dedup). A reconnecting runner resumes via `Last-Event-ID` at the
   batch `id:` (`stream-modes.md §Resumption`) so a dispatch is never redelivered
   past the runner's cursor. Because a runner side effect (a subscription-CLI turn =
   real spend; a tool action) is **not itself idempotent**, `Last-Event-ID` alone is
   insufficient: the **host MUST additionally drop (not re-dispatch) any redelivered
   `{runId, stepId}` whose result is already persisted** — an at-most-once
   host-side idempotency guarantee, defense-in-depth beyond the runner cursor. No new
   framing is invented.
2. **Granularity — RESOLVED: per-step dispatch, not whole runs.** The host routes
   only individual model/tool **dispatch steps** and remains the sole
   orchestration/persistence/replay authority; the runner is a **stateless dispatch
   executor**. Dispatch frame `{ runId, stepId, provider/model | tool, inputs }`;
   result frame `{ runId, stepId, output }`. Whole-run routing is rejected: it would
   move replay authority off-host and break `POST /v1/runs/{runId}:fork`. The frame
   shape carries both model- and tool-dispatch from v1; a host MAY implement
   model-dispatch first and add tool-dispatch later behind the same capability gate
   (openwop-app ADR 0182 Phase 5 lands model-dispatch first).
3. **Replay/fork — RESOLVED: replay never re-dispatches; fork re-routes, no pin.**
   Each dispatch result is persisted as a normal step record, so replay reads from
   persistence and MUST NOT re-dispatch to the runner (`replay.md`). A fork of a run
   whose steps executed on a now-absent runner re-routes *future* dispatch to any
   runner owned by **the run's owning subject** (the stable RFC 0048 principal the
   host stamps on `run.metadata`, NOT a fresh id) with a matching capability; it MUST
   NOT pin to the original `runnerId`. Dispatch to an absent runner fails with the
   distinct **retriable** error `runner_unavailable`.
4. **Runner capability schema — RESOLVED.** A runner registers
   `{ runnerId, subject, capabilities: { providers?: string[], models?: string[],
   tools?: string[] } }`, where `subject` is the run's owning RFC 0048 principal
   (§3). Work is addressed by `runnerId` (direct) or by capability-match. **Match
   MUST filter on `subject` FIRST, then capability** — never the reverse — so a
   capability match can never route a subject's step to another subject's runner (a
   cross-tenant leak); the gated conformance scenario MUST assert this subject-first
   ordering explicitly (SR-1-adjacent). The registration record is per-subject
   runtime state and MUST NOT appear on `/.well-known/openwop`; only the
   `selfHostedRunner: { supported: boolean, ... }` discovery block does (root-level,
   per the RFC 0073 document-root layout, modeled on `agents`/`connections`/`a2a`).

## Adoption / conformance

A new gated conformance scenario asserting **subject-first match** (a capability
match never routes across subjects — OQ4), **at-most-once dispatch** (a redelivered
`{runId, stepId}` with a persisted result is dropped, not re-dispatched — OQ1),
credential non-transit, and `runner_unavailable` on liveness loss. Two new
protocol-tier SECURITY invariants land in lockstep with the capability (each with a
matching public test): **runner-credential-non-transit** (a runner credential MUST
NOT appear in any dispatch/result frame, run event, result, or log — modeled on the
BYOK SR-1 family + `subscription-credential-user-scope-only`) and
**runner-output-untrusted-transport** (runner-returned content re-entering an agent
loop MUST be fenced `<UNTRUSTED>` — modeled on `node-pack-output-untrusted`). The
shape probe is always-on/server-free; the behavioral leg gates on `selfHostedRunner`
and soft-skips when unadvertised (hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`).
Reference-host advertisement (openwop-app ADR 0182 Phase 5; a second witness)
proceeds only once this reaches `Accepted`.

## Status history

### Active → Accepted (2026-07-02)

Graduated on **dual-witness evidence** vs published conformance suite
`@openwop/openwop-conformance@1.48.0`. Per `GOVERNANCE.md` §"Acceptance evidence
tiers" this is a **tier-1 reference (openwop-app) + tier-2 (MyndHyve
steward-affiliated sibling)** graduation — not independent-organization
dual-witness. **Both witnesses are LIVE-DEPLOYED** (each on a real deployed Cloud
Run revision, advertising `selfHostedRunner` honest-off `supported:false` on its
live `/.well-known/openwop` — the openwop-app row via prod `app.openwop.dev`, the
MyndHyve row via a `--no-traffic --tag` witness revision) and were
**steward-curl-verified** 2026-07-02 (discovery honest-off + the `POST
/v1/host/sample/runner/register` seam live, HTTP 400 on a minimal payload, NOT a
404 route-absent). Both pass the gated `self-hosted-runner` scenario
**non-vacuously** under `OPENWOP_REQUIRE_BEHAVIOR=true` (the tier-3
`POST /v1/host/sample/runner/{register,dispatch}` seam RUNS — `register` → HTTP
200, not a 404 soft-skip — driving each host's real subject-first match + real
`{runId, stepId}` at-most-once result store, not a fabricating mock).

Witnesses:

- **openwop-app reference host** (tier-1) — PR openwop-app#1066 **merged to
  `main`**; **live in prod** at `app.openwop.dev`, Cloud Run rev
  `openwop-app-backend-00363-gtg` @ 100%. (CI was red only on the GitHub-Actions
  billing outage — jobs failed at startup with 0 steps; the local `npm run ci`
  gate is authoritative per CLAUDE.md → backend suite 3889 passed; admin-override
  merge.) `host/selfHostedRunner.ts` per-subject registry + subject-first match (no
  cross-subject fallback) + at-most-once `{runId, stepId}` dedup on a real
  `DurableCollection`; §19 seam via `routes/runnerSeam.ts`; advertises
  `selfHostedRunner { supported:false→true, dispatchKinds:["model"] }`
  (honest-off pre-flip; steward-curl-verified live honest-off). Published
  `self-hosted-runner.test.ts` **7/7** under `OPENWOP_REQUIRE_BEHAVIOR=true` —
  subject-first `runner_unavailable` (HTTP **409** + `retriable:true`) with no
  cross-subject fallback, and `deduped:true` on a redelivered `{runId, stepId}`
  backed by the persisted result. Both invariants honored
  (`runner-credential-non-transit`: closed frames, token stays on the runner;
  `runner-output-untrusted-transport`: output fenced `<UNTRUSTED>`). Model-dispatch
  arm first (ADR 0182 Phase 5); the SSE outbound-dial product channel is deferred.
  No vendor-CLI spawn in `backend/src` (ADR 0182 gate holds).
- **MyndHyve `workflow-runtime`** (tier-2) — PR myndhyve#192. **Live-deployed**
  witness revision `workflow-runtime-00516-yuz` (tag `rfc0122`, **0% traffic** —
  prod serving untouched, RFC 0115 witness pattern; steward-curl-verified live
  honest-off `selfHostedRunner { supported:false, dispatchKinds:["model","tool"] }`
  + seam live `register` → 200). `host/selfHostedRunner.ts` SSOT: subject-first
  match keyed on the RFC 0048 `Principal` (filters subject before capability, no
  cross-subject fallback) + at-most-once `{runId, stepId}` dedup on a real
  persisted store (same idempotency shape as its `run_claims` registry) + a
  loopback runner that really answers so the dedup leg is non-vacuous. Published
  `@openwop/openwop-conformance@1.48.0` `--filter self-hosted-runner` **16 passed /
  0 failed** under `OPENWOP_REQUIRE_BEHAVIOR=true`
  (`OPENWOP_OPTED_OUT_PROFILES=openwop-self-hosted-runner`, `supported:false`
  pre-flip; tier-3 seam RUNS `register` → 200, not a 404 soft-skip). Non-vacuity
  independently re-proven live via curl with fresh identifiers: subject-first
  register-subjB → dispatch-subjA → **503**
  `{error:{code:"runner_unavailable",retriable:true}}` (no cross-subject fallback);
  first dispatch `deduped:false` → redelivery `deduped:true`; result `output`
  fenced `<UNTRUSTED>…</UNTRUSTED>` + `contentTrust:"untrusted"`
  (`runner-output-untrusted-transport`); closed frames, no credential field
  (`runner-credential-non-transit`).

**Status-status flip note.** The `runner_unavailable` numeric HTTP status is
**host-chosen** (any `>= 400`): the conformance witness asserts the envelope
`{ error: { code: "runner_unavailable", retriable: true } }`, NOT a fixed status
(mirrors `run_forbidden` / `capability_required`; registered in
`rest-endpoints.md` §"Common error codes" per #815). openwop-app returns `409`,
MyndHyve returns `503` — both conformant, both witnessed non-vacuously; the two
reference witnesses at 409/503 demonstrate the envelope-not-status contract
holds cross-host.

### Draft → Active (2026-07-02)

Promoted under the **bootstrap-phase steward waiver** per `CONTRIBUTING.md`
§"Bootstrap-phase notes" + `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" — the
same path RFC 0031 / 0046 / 0095 / 0108 / 0121 used. **The 7-day comment window is
waived** (single-steward bootstrap repo; zero external reviewers). This promotion is
**non-normative** — a status change only; no wire, schema, or behavior change lands
in this commit.

Evidence at promotion:

- **Classification firm — `additive`** per `COMPATIBILITY.md` §2.1: a new OPTIONAL
  root capability + a new spec doc + new gated scenarios + two RFC-authorized
  SECURITY invariants. No existing required field, event shape, endpoint contract,
  error code, or `MUST` is touched. Hosts that omit `selfHostedRunner` stay fully
  v1-compliant; no version-negotiation impact.
- **Wire-shape locked** — the four Open questions are resolved above (SSE outbound
  transport + monotonic dispatch sequence; per-step dispatch granularity; replay-
  from-persistence + no-pin fork + `runner_unavailable`; the `selfHostedRunner`
  discovery block + off-wire runner registration record). Architect-reviewed
  2026-07-02; no shape change expected before `Accepted`.
- **Safety rail preserved at the implementation gate.** No host may advertise or
  claim `selfHostedRunner` until `Accepted`; reference hosts may wire the channel
  *behind the capability gate* (seam-wired, soft-skipping) at `Active`.
- **Path to `Active → Accepted`:** land `spec/v1/self-hosted-runner.md` + the
  `selfHostedRunner` capability in `capabilities.md` + the schemas + the two SECURITY
  invariants + the gated conformance scenario (published in a conformance bump);
  then a dual reference-host witness (openwop-app ADR 0182 Phase 5 + a second host)
  passes the gated scenario non-vacuously and honestly advertises.

### Draft (2026-07-02)

Authored to open the design and unblock the deferred Phase 5 of openwop-app ADR 0182
(self-hosted subscription-CLI execution driven from a remote/hosted control plane),
closing the execution-locality gap RFC 0108 (host-reachable endpoint only) and RFC
0121 (needs a local client) leave open (PR #812).
