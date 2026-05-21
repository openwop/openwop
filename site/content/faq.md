# Frequently asked questions

OpenWOP is a wire-level protocol, not a library or runtime. The questions below are the ones that come up first when someone evaluates whether the protocol fits their work. Every answer cites the spec doc, RFC, or repo file that carries the authoritative version of the rule.

Last reviewed: 2026-05-21.

## Why not just use LangGraph or LangChain?

LangGraph is a library; OpenWOP is a wire contract. LangGraph workflows depend on the Python runtime they were authored in — the engine, the checkpointer, and the serialization format are all internal to the library. OpenWOP defines what goes over the wire — REST endpoints, SSE event shapes, signed webhook payloads, BYOK secret resolution — so a workflow authored for one host can move to a different host without rewriting application code.

If you only ever run on a single runtime, a library is the simpler choice. If you want your workflows portable across hosts (your own, your customers', a future managed service), the wire contract is the point. See [Where it sits, and what it isn't](/#context) for the longer comparison and the [comparison table](/#context) at a glance.

## Why not Temporal or AWS Step Functions?

Both are excellent durable workflow engines, and both define proprietary wire formats. OpenWOP sits in the same problem space but is vendor-neutral by construction — five host implementations exist already, three of them maintained by the OpenWOP project and one by a third party. The conformance suite at [`/conformance/`](/conformance/) is the public artifact that keeps "wire-compatible" honest.

OpenWOP is also scoped specifically for multi-agent execution — supervisor / worker / conversation agents, BYOK provider routing, replay-safe agent memory — where Temporal and Step Functions are general workflow engines that you'd build the agent semantics on top of.

## What does it actually cost a host to implement OpenWOP?

A minimal host implementing the `openwop-core` profile is a single Node file plus a SQLite (or in-memory) event log. The [in-memory reference host](https://github.com/openwop/openwop/tree/main/examples/hosts/in-memory) is ~2,000 LOC. The [Python in-memory host](https://github.com/openwop/openwop/tree/main/examples/hosts/python) is stdlib-only — no third-party packages.

Implementing more profiles adds surface incrementally: webhooks (HMAC signing), interrupts (4 kinds), BYOK (provider routing + redaction), audit-log integrity (Ed25519 signing), production-profile (backpressure + retention sweeper). Each profile maps to a conformance scenario file you can run against your host with no wrapper code. Profile predicates are at [`/profiles/`](/profiles/).

## Why publish packs to `packs.openwop.dev` instead of npm or PyPI?

Pack tarballs need a chain-of-trust signature (Ed25519, rooted at `openwop-registry-root`) that npm and PyPI don't natively provide for arbitrary binary payloads. The OpenWOP registry serves the signed tarball + the detached signature + the publisher's public key, and the [pack-consumer reference implementation](https://github.com/openwop/openwop/tree/main/examples/hosts/postgres/src/pack-consumer.ts) verifies the signature at install time.

You can absolutely publish packs to a private registry or a tenant-scoped mirror — the [`registry-operations`](/spec/v1/registry-operations.html) spec defines the discovery shape so clients can point at any registry that implements `/.well-known/openwop-registry`. The public registry is just the canonical example.

## When does OpenWOP v1 reach end of life?

There is no scheduled EOL for v1. The [compatibility policy](/versioning/) is explicit: v1.x evolves additively, safety-fixes follow a 90-day public window per `COMPATIBILITY.md` §3, and breaking changes land only in v2 — which has no committed date. Workflows pinned to v1.x today will continue to load on conformance-tested v1.x hosts. The [version-negotiation runbook](/spec/v1/version-negotiation.html) covers the four axes that govern in-flight run safety across deploys.

## How does BYOK work?

Clients supply provider credentials (Anthropic, OpenAI, Google, etc.) on a per-run basis via `RunOptions.configurable.aiProviders` or per-call via `ctx.callAI({provider, ...})`. The host resolves the secret, never logs it, never echoes it in events or debug bundles, and applies redaction rules per the [secret-leakage threat model](https://github.com/openwop/openwop/blob/main/SECURITY/threat-model-secret-leakage.md). The SR-1 invariant in [`/security/`](/security/) is the public test that this redaction holds across every host-tier protocol surface.

Hosts can advertise their BYOK policy modes (`disabled` / `optional` / `required` / `restricted`) via `capabilities.aiProviders` so clients can pre-flight check before submitting a run.

## Is OpenWOP suitable for non-AI workflows?

Yes. The protocol is structured around durable workflow orchestration; the AI-specific surfaces (provider routing, model capabilities, agent memory, reasoning events) are optional capability gates. A host can implement `openwop-core` + `openwop-interrupts` + `openwop-stream-sse` without ever exposing an AI provider. The terminology leans toward multi-agent execution because that's the dominant use case today, but the wire shape doesn't require it.

## How do I get notified about security advisories?

Watch the [openwop/openwop repository on GitHub](https://github.com/openwop/openwop) for releases — that's the canonical channel. Every advisory is published as a tagged release with a `### Security` heading in CHANGELOG.md citing the advisory ID, the affected versions, and the migration path. Pre-disclosure embargo follows [`SECURITY.md`](/security/) §"Disclosure window."

The [`/changelog/`](/changelog/) page on this site mirrors the CHANGELOG.md content. RSS feed and email notification aren't on the roadmap; the GitHub release watch is the supported subscription path.
