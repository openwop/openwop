# OpenWOP v2 specification

> **Status: released · corpus v2.3.3.** The authoritative version is
> [`release.json`](./release.json). Target v2 for new implementations.

OpenWOP v2 is the current protocol major. Its contract consists of this
directory, [`schemas/v2/`](../../schemas/v2/), and
[`api/v2/`](../../api/v2/). Those artifacts are published together in
`@openwop/spec-artifacts` and measured by `@openwop/openwop-conformance` 2.x.

v1 remains available during the overlap period. Dual-stack requirements and
the retirement rule are defined in
[`core/versioning.md`](./core/versioning.md#5-the-overlap-rfc-0167-b5-rfc-0176)
and [`core/overview.md`](./core/overview.md).

## Start here

1. [`core/overview.md`](./core/overview.md) — scope, conformance target, and
   lifecycle.
2. [`core/versioning.md`](./core/versioning.md) — discovery and major-version
   negotiation.
3. [`core/capabilities.md`](./core/capabilities.md) — the closed discovery
   document.
4. [`core/runs.md`](./core/runs.md), [`core/events.md`](./core/events.md), and
   [`core/interrupt.md`](./core/interrupt.md) — the execution model.
5. [`core/security-defaults.md`](./core/security-defaults.md) and
   [`core/conformance.md`](./core/conformance.md) — mandatory safety defaults
   and evidence rules.

## Source-of-truth map

| Path | Purpose |
| --- | --- |
| [`declaration.json`](./declaration.json) | Hand-reviewed inventory of discovery keys, capability families, maturity, witnesses, facets, profiles, and peer-dependency identifiers. |
| [`declaration.schema.json`](./declaration.schema.json) | Schema for the declaration. |
| [`core/`](./core/) | Normative protocol prose. |
| [`ext/`](./ext/) | Optional extensions and explicitly non-core notes. See the extension maturity rules in [`ext/README.md`](./ext/README.md). |
| [`facets/`](./facets/) | Hand-reviewed capability facet schemas. |
| [`errors.json`](./errors.json) | Error-code registry. |
| [`event-codemap.json`](./event-codemap.json) | v1-to-v2 event-name mapping. |
| [`path-manifest.json`](./path-manifest.json) | Canonical operation and channel paths. |
| [`profiles.json`](./profiles.json) | Generated profile predicates. |
| [`peer-dependency-aliases.json`](./peer-dependency-aliases.json) | Generated v1 alias mapping. |
| [`release.json`](./release.json) | Authoritative corpus release identity. |

Generated files identify their generator in `$comment` or their header. Do not
edit generated outputs directly. Machine artifacts are published in
`@openwop/spec-artifacts`; the conformance package consumes them as an
exact-version peer dependency.

## Core documents

| Area | Documents |
| --- | --- |
| Foundation | [`overview`](./core/overview.md), [`versioning`](./core/versioning.md), [`headers`](./core/headers.md), [`identity`](./core/identity.md), [`capabilities`](./core/capabilities.md) |
| Execution | [`runs`](./core/runs.md), [`events`](./core/events.md), [`interrupt`](./core/interrupt.md), [`persistence`](./core/persistence.md), [`idempotency`](./core/idempotency.md), [`replay`](./core/replay.md) |
| Integration | [`webhooks`](./core/webhooks.md), [`interop`](./core/interop.md), [`packs`](./core/packs.md), [`connection packs`](./core/connection-packs.md), [`form-content packs`](./core/form-content-packs.md), [`workflow-chain packs`](./core/workflow-chain-packs.md) |
| Reliability | [`errors`](./core/errors.md), [`security defaults`](./core/security-defaults.md), [`conformance`](./core/conformance.md) |
