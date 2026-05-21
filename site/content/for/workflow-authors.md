# For workflow authors

You're building a product that runs multi-agent workflows. You want the durable, replayable, resumable parts handled by something other than your application code, and you don't want to be locked to one runtime. This page is the shortest path from here to a running workflow on an OpenWOP-compatible host.

## What you actually need to know

OpenWOP gives you a wire contract — REST endpoints to start runs, SSE streams to consume events, signed webhooks for durable delivery, and a typed run lifecycle that survives restarts. You write workflows declaratively (nodes + edges + typed channels + reducers) and submit them to any conformance-tested host. The host owns the runtime; your code owns the workflow shape.

You don't need to know how the host stores its event log, how it routes provider calls, or how it implements suspend/resume. Those are host concerns gated behind capability flags you can read from `GET /.well-known/openwop`.

## Read these four spec docs first

- [Run options &amp; lifecycle](/spec/v1/run-options.html) — what a run actually is, the per-run policy inputs, and the state machine.
- [REST endpoints](/spec/v1/rest-endpoints.html) — the canonical endpoint catalog (create, get, stream, interrupt, fork, etc.).
- [Stream modes](/spec/v1/stream-modes.html) — `values` / `updates` / `messages` / `debug` and how to pick the right one for your UI.
- [Channels &amp; reducers](/spec/v1/channels-and-reducers.html) — how typed shared state moves between nodes and how concurrent writes resolve at fan-in points.

That's the minimum surface to author and submit a non-trivial workflow.

## Reach for these when you hit them

- [Interrupts](/spec/v1/interrupt.html) — when your workflow needs to pause for a human (clarification, approval, quorum, external event).
- [Webhooks](/spec/v1/webhooks.html) — when you need durable, signed delivery of run events to your backend.
- [Replay](/spec/v1/replay.html) — when you need to fork a run from a historical checkpoint (debugging, "what if" exploration, retroactive policy change).
- [Agent memory](/spec/v1/agent-memory.html) — when your supervisor agent needs to carry context across runs without leaking secrets or crossing tenant boundaries.

## Get to a running workflow

The fastest path: clone the repo, start the in-memory reference host (Node, ~2 minutes), submit a fixture run over HTTP, watch the events stream back over SSE. The [ten-minute quickstart](https://github.com/openwop/openwop/blob/main/QUICKSTART-10MIN.md) walks the whole thing.

When you're ready to move past the in-memory host, the [SQLite](https://github.com/openwop/openwop/tree/main/examples/hosts/sqlite) and [Postgres](https://github.com/openwop/openwop/tree/main/examples/hosts/postgres) reference hosts add durability tiers; the [Python host](https://github.com/openwop/openwop/tree/main/examples/hosts/python) is the cross-language portability proof.

## What you'll write yourself

- The workflow definition (graph + channels + reducers + nodes — declarative).
- The node implementations OR a manifest pointing at pre-published [node packs](/spec/v1/node-packs.html).
- Your client code — a thin wrapper over the REST endpoints; the [TypeScript SDK](https://github.com/openwop/openwop/tree/main/sdk/typescript) and [Python SDK](https://github.com/openwop/openwop/tree/main/sdk/python) cover the canonical methods.

## What you don't write

- A durable event log.
- A suspend/resume mechanism.
- A replay engine.
- An interrupt state machine.
- Provider routing and BYOK secret resolution.
- HMAC-signed webhook delivery.

Those are host responsibilities, defined normatively in the spec corpus and verified by the conformance suite.

## Next steps

| Action | Where |
|---|---|
| Run the quickstart | [QUICKSTART-10MIN.md ↗](https://github.com/openwop/openwop/blob/main/QUICKSTART-10MIN.md) |
| Try the live host | [app.openwop.dev ↗](https://app.openwop.dev/) |
| Read the run lifecycle spec | [/spec/v1/run-options.html](/spec/v1/run-options.html) |
| Compare host implementations | [/conformance/](/conformance/) |
| Ask a question | [GitHub Issues ↗](https://github.com/openwop/openwop/issues) |
