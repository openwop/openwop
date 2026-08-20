# Implement a conforming OpenWOP host

> **Read this instead of the corpus.** The specification is 60 documents and
> ~220,000 words. **You do not need most of it.** A host that satisfies
> `openwop-core-standard` is conformant, interoperable, and can advertise itself
> as such; every other document in `spec/v1/` describes an **optional** surface
> you may ignore until you want it.
>
> This page exists because the size of the corpus, not its content, is the main
> barrier to an independent implementation — and an independent implementation is
> the one thing the protocol most needs. If anything here is wrong or
> under-specified for a real implementer, that is a defect worth a PR.

## What conformance actually requires

`openwop-core-standard` has **nine floor scenarios**. That is the whole bar.

| Floor scenario | What your host must do |
| --- | --- |
| `discovery` | Serve `GET /.well-known/openwop` describing what you support |
| `runs-lifecycle` | Create a run, report its status, reach a terminal state |
| `auth` | Reject unauthenticated and cross-tenant access |
| `eventOrdering` | Emit a run's events in a stable, monotonic order |
| `failure-path` | Reach terminal `failed` with a structured `error` object |
| `idempotency` | Honour `Idempotency-Key` on run creation |
| `idempotency-key-determinism` | Derive the key deterministically from the documented tuple |
| `webhook-negative` | Refuse malformed webhook registrations correctly |
| `any.interrupt-` | Support **at least one** interrupt kind end-to-end |

Note the shape of the last row: the floor asks for *one* interrupt kind, not all
eight. That pattern repeats throughout — **the floor asks for the property, not
for the full surface.**

## The four documents you need

Read these, in this order. Everything else is reference.

1. **[`rest-endpoints.md`](../spec/v1/rest-endpoints.md)** — the endpoints, request and response shapes.
2. **[`capabilities.md`](../spec/v1/capabilities.md)** — the discovery document, and §"What a capability may vary" so you advertise honestly.
3. **[`stream-modes.md`](../spec/v1/stream-modes.md)** — how a run's events reach a client, and the order they must arrive in. (`eventOrdering.test.ts` verifies against this and `observability.md`.)
4. **[`interrupt.md`](../spec/v1/interrupt.md)** — durable suspend and resume; pick one kind.

Plus **[`idempotency.md`](../spec/v1/idempotency.md) §A** when you get to run
creation, and **[`error-envelope.schema.json`](../schemas/error-envelope.schema.json)**,
which is small and which everything else assumes.

## What you can ignore, and for how long

| Surface | Ignore until |
| --- | --- |
| Multi-agent orchestration, agent packs, memory | You want agents. The core has no opinion about them. |
| Replay and fork | You want time travel. A host with no `:fork` endpoint is conformant. |
| Compensation | You have effects worth unwinding. Non-advertising hosts **refuse** compensation workflows — which is correct, not degraded. |
| MCP / A2A composition | You want to talk to other ecosystems. |
| Node packs, sandboxing, registries | You want third-party code in your runs. |
| Workload identity, mTLS, delegation | Your deployment needs them. Bearer-token auth is conformant. |
| Multi-region, effect fencing | You are multi-region. |
| OpenTelemetry mapping | You want cross-host traces. |

**None of these are second-class.** They are optional because a protocol whose
core is small is one people can implement, and OpenWOP's optional surfaces are
where most of its design work went. The point is that they are optional *in the
order you need them*, not all at once on day one.

## Verifying yourself

```bash
npx @openwop/openwop-conformance \
  --base-url https://your-host.example \
  --api-key "$KEY" \
  --filter "discovery|runs-lifecycle|auth|eventOrdering|failure-path|idempotency|webhook-negative|interrupt-"
```

When those pass, run the whole suite. Most of it will record `inapplicable` or
`blocked`, and **that is the correct result** — those dispositions mean
*"this host does not advertise the capability"* and *"this host has not wired the
seam"*, not *"this host failed"*. Read
[`conformance/coverage.md`](../conformance/coverage.md) for the vocabulary.

Then produce a certification bundle:

```bash
npx @openwop/openwop-conformance --base-url … --api-key … --certify bundle.json
```

The bundle derives your claimed profiles **from your discovery document**, not
from anything you assert. You cannot over-claim in it, which is the point.

## Three things implementers get wrong

1. **Advertising a capability you have not wired.** The suite runs
   `OPENWOP_REQUIRE_BEHAVIOR=true` in strict mode and fails an advertisement with
   no behavioural witness. Advertise nothing until it works; an unadvertised
   capability is not a gap, it is an honest host.
2. **Treating `blocked` as failure.** A `blocked` row means *unobservable*, not
   *unmet*. Hosts with an SSRF guard correctly refuse the suite's loopback
   webhook receiver and record `blocked` — the security control is right and the
   row is honest.
3. **Substituting instead of refusing.** If you do not support a construct,
   **refuse it observably** (`capability_required`). Silently doing something
   adjacent is the one thing `capabilities.md` §"Unsupported capability"
   forbids, because it makes a workflow's meaning depend on which host ran it.

## When you are done

Publish your bundle at a stable URL and tell us — an
[`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) row from an implementer outside this
project is worth more to the protocol than any specification work currently on
the roadmap. **Publish it whatever it says.** A bundle with failures and blocked
rows is evidence; a bundle that was tuned until it was green is not.
