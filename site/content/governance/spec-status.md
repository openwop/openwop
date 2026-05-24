# Spec status policy

The four labels below are the only status tiers a spec document under `spec/v1/` may carry. The same vocabulary applies to RFC sections and capability profile claims. They are deliberately ordered from most-stable (top) to most-fluid (bottom).

## The four tiers

### Stable

The wire surface is frozen under the v1.x compatibility contract. Required fields, endpoint contracts, event payloads, JSON Schema shapes, and SDK package names are locked. A change to a Stable surface is a **breaking change** and SHALL be deferred to v2.

Hosts MAY advertise Stable surfaces via `/.well-known/openwop` without any profile gate. Conformance scenarios MUST be runnable against any Stable surface.

### Stabilizing

The required-field set and endpoint shapes are locked, but the document is still landing additive expansions — new optional fields, additional event-payload variants, broader behavior coverage. Implementations conforming to a Stabilizing surface SHOULD expect their conformance pass-rate to climb over time as new scenarios land, without their code needing to change.

A Stabilizing surface MAY graduate to Stable in a minor release once its conformance coverage stops moving. Hosts MAY advertise Stabilizing capabilities via `/.well-known/openwop` and MUST gate them behind a named profile.

### Draft

Section headings, broad surface shape, and the high-level wire contract are stable enough to review and prototype against, but field schemas and event payloads MAY shift on each weekly RFC roll-up. Draft documents typically have an open RFC governing the comment window.

Implementations against a Draft surface SHALL expect to make code changes when the surface graduates to Stabilizing or Stable. Hosts SHOULD NOT advertise Draft surfaces via `/.well-known/openwop` outside of explicit experimental opt-in profiles.

### Experimental

The document sketches an in-flight surface — direction set, but neither field shapes nor event payloads are locked. Anything inside an Experimental document MAY break across patch releases. Implementers SHOULD pin only to what is explicitly written and assume gaps everywhere else.

Hosts MUST NOT advertise an Experimental capability outside of an explicit opt-in profile, and conformance scenarios for an Experimental surface SHALL run as `it.todo` until the surface graduates.

## Mapping from earlier vocabulary

Earlier revisions of `spec/v1/` used a five-label system. The replacement mapping is direct:

| Old label | New tier      | Notes |
|-----------|---------------|-------|
| **FINAL** | **Stable**    | Direct synonym. Every doc previously labelled FINAL is now Stable. |
| **DRAFT** | **Draft**     | Same meaning, different casing — "Draft" everywhere in title-case prose. |
| **OUTLINE** | **Stabilizing** | A locked-but-still-growing surface lands here. |
| **STUB**  | **Experimental** | Section headings exist but field schemas may shift. |

`FINAL` remains a recognized synonym for `Stable` in legacy contexts so that older host claims (e.g., a `vendor.foo.profile@v1.0` advertisement string referencing `FINAL`) parse without an error. Authoring of new documents SHALL use the four-tier vocabulary.

## Where the label appears

Every spec document under `spec/v1/` carries a single status banner at the top of the file:

```
> **Status: <Tier> · v1.x (YYYY-MM-DD).** <one-sentence scope summary>
```

The renderer in `site/src/build.mjs` lifts this banner verbatim onto the document page header and into the `/spec/v1/` index card. The same renderer normalizes the parens-wrapped date into a `·`-separated chip on the index page.

## Promotion process

A spec document graduates between tiers via an RFC and a CHANGELOG entry, never silently:

1. **Experimental → Draft** — landed via an open RFC that opens a comment window. Field shapes are negotiable inside the window.
2. **Draft → Stabilizing** — RFC closes; the comment window expires; required-field set and endpoint shapes lock. Document is editable additively.
3. **Stabilizing → Stable** — every required-field gap closes, conformance coverage stabilizes, and the steward declares the surface frozen for v1.x. Demotion from Stable inside v1.x requires a safety-fix RFC under [COMPATIBILITY.md §3](https://github.com/openwop/openwop/blob/main/COMPATIBILITY.md).

A document MAY skip tiers (e.g., a fully-specified surface lands directly at Stable inside an existing RFC), but never silently. The CHANGELOG entry SHALL name the new tier.

## Acceptance criteria

A spec document SHALL be at the **Stable** tier if and only if:

- Required-field set is closed and conformance scenarios cover every required field.
- Endpoint contracts are present in `api/openwop.yaml` (and `api/grpc/openwop.proto` for gRPC-eligible endpoints).
- Event payloads are present in `api/asyncapi.yaml` and `schemas/`.
- The corresponding capability profile is advertisable in the `/.well-known/openwop` document without an opt-in flag.
- No `it.todo` blocks against the document remain in `@openwop/openwop-conformance` outside of an explicit profile gate.

A document failing any of these criteria SHALL be labelled **Stabilizing** at most.
