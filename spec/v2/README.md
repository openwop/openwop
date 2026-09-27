# OpenWOP v2 specification

> **Status: released · current corpus.** The authoritative version is
> [`release.json`](./release.json). Target v2 for new implementations.

OpenWOP v2 is the current protocol major. Its contract is this directory,
[`schemas/v2/`](../../schemas/v2/), and [`api/v2/`](../../api/v2/). They are
published together as `@openwop/spec-artifacts` and tested by
`@openwop/openwop-conformance` 2.x.

v1 is still supported during the overlap period.
[`core/versioning.md`](./core/versioning.md#5-the-overlap)
and [`core/overview.md`](./core/overview.md) define how a host serves both and
when v1 ends.

## Start here

1. [`core/overview.md`](./core/overview.md) — scope, conformance target, and
   lifecycle.
2. [`core/versioning.md`](./core/versioning.md) — discovery and major-version
   negotiation.
3. [`core/capabilities.md`](./core/capabilities.md) — the discovery document.
4. [`core/runs.md`](./core/runs.md), [`core/events.md`](./core/events.md), and
   [`core/interrupt.md`](./core/interrupt.md) — the execution model.
5. [`core/security-defaults.md`](./core/security-defaults.md) and
   [`core/conformance.md`](./core/conformance.md) — mandatory safety defaults
   and evidence rules.

## Core documents

| Area | Documents |
| --- | --- |
| Foundation | [`overview`](./core/overview.md), [`versioning`](./core/versioning.md), [`headers`](./core/headers.md), [`identity`](./core/identity.md), [`oauth`](./core/oauth.md), [`capabilities`](./core/capabilities.md), [`i18n`](./core/i18n.md) |
| Execution | [`runs`](./core/runs.md), [`events`](./core/events.md), [`interrupt`](./core/interrupt.md), [`conversation`](./core/conversation.md), [`persistence`](./core/persistence.md), [`idempotency`](./core/idempotency.md), [`replay`](./core/replay.md) |
| Integration | [`webhooks`](./core/webhooks.md), [`interop`](./core/interop.md), [`host services`](./core/host-services.md), [`tool catalog`](./core/tool-catalog.md), [`portability`](./core/portability.md), [`packs`](./core/packs.md), [`node-pack runtimes`](./core/node-pack-runtimes.md), [`connection packs`](./core/connection-packs.md), [`form-content packs`](./core/form-content-packs.md), [`workflow-chain packs`](./core/workflow-chain-packs.md) |
| Reliability | [`errors`](./core/errors.md), [`security defaults`](./core/security-defaults.md), [`conformance`](./core/conformance.md) |

## Source-of-truth map

| Path | Contents |
| --- | --- |
| [`core/`](./core/) | The normative protocol documents |
| [`ext/`](./ext/) | Optional extensions and non-core notes ([maturity rules](./ext/README.md)) |
| [`declaration.json`](./declaration.json) | Inventory of discovery keys, capability families, maturity, witnesses, facets, profiles, and peer-dependency ids |
| [`declaration.schema.json`](./declaration.schema.json) | Schema for the declaration |
| [`facets/`](./facets/) | Capability facet schemas |
| [`errors.json`](./errors.json) | Error-code registry |
| [`event-codemap.json`](./event-codemap.json) | v1-to-v2 event-name mapping |
| [`path-manifest.json`](./path-manifest.json) | Canonical operation and channel paths |
| [`profiles.json`](./profiles.json) | Profile predicates (generated) |
| [`peer-dependency-aliases.json`](./peer-dependency-aliases.json) | v1 alias mapping (generated) |
| [`release.json`](./release.json) | Corpus release identity |
| [`migrations.json`](./migrations.json) | Surfaces a 2.x minor replaced, and the deprecation row that retires each |
| [`corrections.json`](./corrections.json) | Corrections that changed a v2 shape without breaking a conforming host |
| [`surface-baseline.json`](./surface-baseline.json) | Every v2 surface, used to check that minors only add (generated) |

Do not edit generated files by hand; each names its generator in `$comment` or
its header. Machine artifacts are published in `@openwop/spec-artifacts`, which
the conformance package consumes as an exact-version peer dependency.
