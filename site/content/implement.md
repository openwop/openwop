# Implementing OpenWOP

Four entry points cover every shape of OpenWOP work. Pick the role that matches what you're building — each card links to the role-specific landing with the specs, schemas, and conformance scenarios that role actually touches.

## Roles

### [Workflow authors →](/for/workflow-authors/)

You're wiring durable multi-agent runs into a product and calling a compliant host over REST + SSE. Start here if you've already picked (or had picked for you) which host you're talking to and you need to know the exact request shape, event order, and replay contract.

### [Host implementers →](/for/host-implementers/)

You're implementing the OpenWOP wire surface against your own runtime (or one your customers picked). Start here for the capability advertisement contract at `GET /.well-known/openwop`, the four reference hosts under `examples/hosts/`, and the conformance suite that gates your host's leaderboard row.

### [Pack authors →](/for/pack-authors/)

You're publishing reusable workflow components — node packs, workflow-chain packs, or agent definitions — to a registry that hosts can consume. Start here for the pack manifest format, signing requirements, and the registry submission process.

### [Production evaluators →](/for/production-evaluators/)

You're evaluating OpenWOP as a substrate for a production workflow. Start here for the production-profile claim, scale tiers, BYOK secret handling, the observability taxonomy, and the conformance evidence that backs each claim.

## Common surface

Regardless of role, every implementer touches:

- **The wire contract** — [`/spec/v1/`](/spec/v1/) prose specs + [REST](/api/rest/) reference + [`schemas/`](https://github.com/openwop/openwop/tree/main/schemas) JSON Schema corpus.
- **Conformance** — [`@openwop/openwop-conformance`](https://github.com/openwop/openwop/tree/main/conformance) plus the live [leaderboard](/conformance/).
- **RFCs** — the [in-flight](/rfcs/) protocol evolution channel; v1.x stays additive-only per [`COMPATIBILITY.md`](https://github.com/openwop/openwop/blob/main/COMPATIBILITY.md).
- **SDKs** — TypeScript on npm, Python on PyPI, Go module — all under [`sdk/`](https://github.com/openwop/openwop/tree/main/sdk).

## Not sure which one you are?

If you're calling somebody else's host → **workflow author**.
If you're answering somebody else's call → **host implementer**.
If you're shipping reusable nodes for either of the above to consume → **pack author**.
If you're choosing which of the above to commit to → **production evaluator**.
