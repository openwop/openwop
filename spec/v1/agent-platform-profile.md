# OpenWOP Spec v1 — `openwop-agent-platform` Operational Annex

> **Status: Stable · v1.x — reached `Accepted` via [RFC 0085](../../RFCS/0085-agent-platform-meta-profile.md) (2026-06-01).** Additive v1.x extension — an **operational annex** (the [`production-profile.md`](./production-profile.md) / [`auth-profiles.md`](./auth-profiles.md) pattern), NOT a new entry in the closed [`profiles.md`](./profiles.md) predicate catalog. Names one coherent "this host behaves like a full agent platform" target with a `partial`/`full` status, an aggregating conformance scenario, and a badge. The live aggregate-evidence assertion against a reference host + the badge rendering land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop now has _many_ optional agent-platform capabilities — manifest + live agent runtime (RFC 0070/0072/0077), a tool catalog + tool hooks (RFC 0078/0064), safe-fetch + egress policy (RFC 0076/0079), provider usage (RFC 0026), a prompt library (RFC 0027/0028), a reconciled memory model (RFC 0004/0057/0080), replay/fork, feedback (RFC 0056), durable triggers (RFC 0083), a debug bundle (RFC 0009), RBAC + tenant scoping (RFC 0049/0074), and — as a platform-plus tier — eval (RFC 0081), deployment (RFC 0082), budget (RFC 0084). But a demo, an adopter, or a buyer has **no single named target** that says "this host behaves like a full agent platform" — they must hand-check a dozen capability flags. This annex adds that target, additively. It **composes — does not redefine** every constituent.

## §A — Why an annex, not the closed catalog

`openwop-agent-platform` is an **operational annex**, alongside `production-profile.md`, `auth-profiles.md`, and `interrupt-profiles.md`. Per `profiles.md` §"Profile semantics": _operational annexes define optional public-release claims; they are separate from the compatibility catalog because they combine runtime behavior, documentation, and conformance evidence rather than pure discovery-payload predicates._ A platform claim requires _runtime behavior + documentation + conformance evidence_ (does the live-runtime scenario actually pass?), not just a discovery predicate — so it does **NOT** enter the closed `profiles.md` predicate catalog (which stays the fine-grained pure-predicate set); `profiles.md` gains only a one-line cross-reference in its annex list.

## §B — The discovery predicate (floor + full)

The `partial` (floor) predicate ANDs the constituent capability checks (the `profiles.md` derivation style — a predicate MAY reference others syntactically):

```text
openwop-agent-platform-partial(c) :=
     openwop-core(c)
  && c.agents.manifestRuntime.supported === true          // RFC 0070/0072 — manifest agents
  && c.agents.liveRuntime.supported === true              // RFC 0077 — live agent runtime
  && c.toolCatalog.supported === true                     // RFC 0078 — portable tool catalog
  && c.toolHooks.supported === true                       // RFC 0064 — tool authorization/audit
  && c.httpClient.safeFetch.supported === true            // RFC 0076 §B — safe egress
  && c.providerUsage.supported === true                   // RFC 0026 — cost/usage
  && c.prompts.supported === true                         // RFC 0027/0028 — prompt library
  && c.memory.supported === true                          // RFC 0004/0080 — memory read/write
  && c.feedback.supported === true                        // RFC 0056 — feedback
  && (c.replay.supported === true || c.nondeterminismPolicy.declared === true)
```

The `full` predicate adds the governance/operability tier:

```text
openwop-agent-platform-full(c) :=
     openwop-agent-platform-partial(c)
  && c.authorization.supported === true                   // RFC 0049 — RBAC, fail-closed
  && c.agents.manifestRuntime.installScope === 'tenant'   // RFC 0074 — tenant scoping
  && c.memory.attribution.supported === true              // RFC 0057 — memory attribution
  && c.debugBundle.supported === true                     // RFC 0009 — debug bundle (capabilities.debugBundle, NOT production.*)
  && c.triggerBridge.supported === true                   // RFC 0083 — durable triggers
  && c.httpClient.egressPolicy.supported === true         // RFC 0079 — egress policy
```

Capability families are document-root properties (RFC 0073), so the predicate reads `c.<family>`. The reference helper is `isAgentPlatformPartial` / `isAgentPlatformFull` / `agentPlatformStatus` in `conformance/src/lib/profiles.ts` (an annex helper, clearly separate from the closed-catalog `deriveProfiles`).

**Platform-plus (advisory, RECOMMENDED for `full` — NOT hard terms in v1.x):** eval (RFC 0081 `agents.evalSuite`), deployment (RFC 0082 `agents.deployment`), budget (RFC 0084 `budget`). A host can be a credible `full` platform while wiring these incrementally; making them hard terms would gate the whole profile on the newest, least-adopted surfaces. A future minor MAY promote them into `full` once ≥1 non-steward host advertises each + its scenario passes. The `replay`-OR-`nondeterminismPolicy.declared` term honors "run replay/fork OR an explicit nondeterminism policy" — an honestly-nondeterministic host declares it rather than failing the floor.

## §C — Required runtime scenarios (the aggregate-evidence rule)

A host **claims** the profile by satisfying the §B predicate **AND passing the constituent profiles' runtime conformance scenarios** (the `profiles.md` "claims vs passes" semantics) — the platform claim is _backed by_ per-capability evidence, never asserted on shape alone. The required floor scenario set: `agent-manifest-runtime.test.ts`, `agent-live-runtime-shape.test.ts`, `tool-descriptor-shape.test.ts`, the tool-hooks scenarios, `safefetch-behavior.test.ts`, the provider-usage scenario, the prompt-library scenarios, `memory-capability-model-shape.test.ts`, the feedback scenario, and `replayDeterminism.test.ts` (or the host's declared nondeterminism). The `full` tier adds the RBAC, tenant-scoping, memory-attribution, debug-bundle, trigger-bridge, and egress-policy scenarios.

The aggregating meta-scenario `agent-platform-profile.test.ts` derives `none`/`partial`/`full` from the discovery payload (§B) and, when `full` is claimed against a live host, asserts every required constituent scenario is in the host's passing set for the reported suite version. It soft-skips the live aggregate (reports `none`) when the floor predicate is unmet.

## §D — `partial` / `full` status + the badge

A host reports one of three statuses (in its `conformance.md` + `INTEROP-MATRIX.md` row):

- **none** — floor predicate unmet.
- **partial** — floor met + floor scenarios pass.
- **full** — full predicate met + governance-tier scenarios pass.

A new **`openwop-agent-platform` badge** ([`openwop.dev/badge/openwop-agent-platform.svg`](https://openwop.dev/badge/openwop-agent-platform.svg), published from the [openwop-site](https://github.com/openwop/openwop-site) repo per `docs/IMPLEMENTATION-CERTIFICATION.md`) renders the status + suite version, so `app.openwop.dev` and any adopter can show "Agent Platform profile: partial / full" backed by `INTEROP-MATRIX.md` evidence. The badge asserts the _aggregate_ claim; it does not replace per-capability badges.

**Honest advertisement (the `production-profile.md` discipline):** a host MUST report `partial` (not `full`) until the full-tier scenarios actually pass — reporting `full` on shape alone is non-conformant by the §C aggregate-evidence rule.

**`satisfiedTerms[]` — the richer interop signal (adoption is non-contiguous).** The flat `none`/`partial`/`full` ladder implicitly assumes _monotonic_ adoption (floor before full), but a real host built feature-by-feature satisfies terms **out of order** — e.g. a host honoring RBAC (RFC 0049) + memory-attribution (RFC 0057) + tenant-scoping (RFC 0074) — three `full`-tier terms — while still missing `liveRuntime`/`toolCatalog` floor terms reads `none`, _identical to a do-nothing host_. To avoid understating such a host, a host SHOULD ALSO report `satisfiedTerms[]` — the exact list of floor/full term ids it satisfies (`floor:memory`, `full:authorization`, …) — alongside the flat status. The reference helper is `agentPlatformSatisfiedTerms` in `conformance/src/lib/profiles.ts`. The flat status remains the headline claim (and gates the badge); `satisfiedTerms[]` is the honest per-term breakdown a registry/Mission Control renders so a `none`-but-6/16 host is distinguishable from a `none`-and-0/16 one. (This non-contiguous-adoption finding came from the first live-host curl-verify of the predicate — RFC 0085 §UQ-followup.)

## Open spec gaps

- The live aggregate-evidence assertion against a reference host (the Postgres host — already `production-profile`-satisfying — is the natural first `partial`/`full` candidate) + the badge rendering are the `Active → Accepted` step, naturally gated on a host actually reaching `partial`/`full`.
- Promotion of the platform-plus tier (eval/deploy/budget) from RECOMMENDED to hard `full` terms is deferred to a future minor, triggered by ≥1 non-steward host advertising each.
