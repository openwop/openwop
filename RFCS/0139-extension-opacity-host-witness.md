# RFC 0139: Host-side witness for pack-manifest extension opacity

| Field             | Value                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0139                                                                                                                                                                                                     |
| **Title**         | Host-side witness for pack-manifest extension opacity                                                                                                                                                    |
| **Status**        | `Active`                                                                                                                                                                                                  |
| **Author(s)**     | David Tufts (@davidscotttufts), with the openwop-app reference host                                                                                                                                      |
| **Created**       | 2026-08-07                                                                                                                                                                                               |
| **Updated**       | 2026-08-07                                                                                                                                                                                               |
| **Affects**       | `spec/v1/node-packs.md`, `conformance/coverage.md`, `conformance/src/lib/artifactTypes.ts`, `conformance/src/scenarios/{pack-manifest-extension-opacity,artifact-type-pack-install,artifact-type-store-without-render,chat-card-pack-execution}.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — with a suite-version consequence, see §Compatibility                                                                                                             |
| **Supersedes**    | —                                                                                                                                                                                                        |
| **Superseded by** | —                                                                                                                                                                                                        |

## Summary

RFC 0138 made pack manifests carry vendor extensions and defined "ignore" normatively — a consumer MUST NOT render, execute, interpret, code-path-switch on, or persist-for-later-interpretation an unrecognized extension. **Nothing verifies any of that against a host.** All 19 of RFC 0138's assertions are server-free; they check that schemas admit the hatch and that the corpus states the rule. This RFC adds the missing witness, and the load-bearing design decision is that **presence assertions cannot express opacity** — a host that stashes an extension blob and interprets it later passes "the manifest installed" trivially. The witness is therefore **differential**: install the same manifest with and without an unrecognized extension and require the host's observable registration projection to be **identical**. That is the only assertion that catches "stash now, interpret later" without enumerating every possible sink.

## Motivation

### The hole RFC 0138 left, in its own words

RFC 0138 §Gaps logged G6 and G7:

> **G6** — No leg asserts a HOST accepts a canonically-shaped extended manifest — only that the schema does.
> **G7** — Nothing detects a host that violates MUST-ignore. A host that renders an extension value fails no test.

This is not a hypothetical class of defect. Wiring an artifact-type seam is what revealed that the reference host's `artifactTypePackLoader` accepted **only** an inline `schema` and had zero references to `schemaRef` — so a spec-conformant third-party pack was **silently rejected** while every one of the host's own packs worked. No conformance leg caught it, because every leg validated the *schema* rather than the *path a pack actually takes*.

An extension hatch verified only against schemas is the same shape of hole, one layer up.

### Why presence is not the assertion

The obvious leg — install an extension-bearing manifest, assert 2xx — proves almost nothing. Restating the failure RFC 0138 names:

> A hatch that hosts half-honor by stashing untrusted blobs into rendering paths is **strictly worse than no hatch**, converting a loud publication failure into a silent injection surface.

A host that stores `x-evil.template` and later interpolates it into a rendered surface **passes** the presence leg. The reference host put this plainly while accepting the co-authorship:

> A leg that installs an extension-bearing manifest and asserts it validates proves almost nothing. The failure your RFC names — a host that stashes the blob and later interprets it — passes that leg trivially.

Three candidate assertions were considered (their enumeration, adopted):

1. the extension does not appear in any rendered/serialised surface the host exposes for that type;
2. an extension whose value is a templating directive or markup is not interpreted anywhere downstream;
3. an **unrecognized extension does not change host behavior** versus the same manifest without it.

(1) and (2) require enumerating sinks, and a suite cannot enumerate a host's sinks. **(3) is adopted** because it is sink-agnostic: it does not ask *where* the extension might leak, it asks whether the host's observable behavior is a function of the extension at all. If the answer is no, every sink is covered at once.

## Proposal

### The differential-install contract (normative)

A host that advertises a declarative pack capability **and** exposes the corresponding host-sample install seam MUST make that seam return an **observable registration projection**: a JSON body describing what the host registered as a result of the install — the registered identifiers, their resolved schema references, and any per-type facets the host derived.

Given two manifests **M** and **M′** that are byte-identical except that **M′** additionally carries one or more properties matching `^(x-|vendor\.)` which the host does not recognize:

- The host **MUST** accept both, or reject both for the same reason. Acceptance **MUST NOT** be a function of the extension's presence.
- The registration projections returned for **M** and **M′** **MUST** be equal after removing the extension properties themselves from the comparison.
- A host that recognizes and acts on a given extension is **out of scope for this assertion for that extension** — the rule is about *unrecognized* extensions. Suites MUST use an extension namespace no host can claim to recognize (`vendor.conformance.*`), so the unrecognized branch is the one exercised.

The projection is **not new protocol wire shape**. It is a host-sample test seam under `/v1/host/sample/*`, which `conformance/coverage.md` §"Open seams" already establishes as host-extension surface that hosts wire for measurement, never a production endpoint and never advertised in `/.well-known/openwop`.

### Why a differential, restated for implementers

The comparison is the whole mechanism, so it is worth being explicit about what it does and does not prove:

- **It proves** the host's registration behavior is not a function of an unrecognized extension. Any sink reached *during install* — a rendering catalog, a code-path switch, a derived facet — shows up as a projection difference.
- **It does not prove** the extension is never interpreted at some later, unrelated moment the seam does not reach. No finite suite can prove that. §Conformance says so rather than implying coverage the leg does not have.

This is a real limit, not a hedge. It is stated because the alternative — a green leg implying total opacity — is exactly the overclaim RFC 0138 was written to avoid.

### The G14 flip

Three scenarios currently bare-`return` soft-skip when a capability is advertised but the seam is absent:

- `artifact-type-pack-install.test.ts`
- `artifact-type-store-without-render.test.ts`
- `chat-card-pack-execution.test.ts`

They report **green** while exercising nothing. The reference host demonstrated this directly: a run reporting "13 passed" under `OPENWOP_REQUIRE_BEHAVIOR=true`, every one a soft-skip, against a host advertising `artifactTypes.supported: true` at the document root.

This RFC flips all three to `behaviorGate`, and extends the gate's reach to the seam. The rule, in the reference host's framing, which this RFC adopts:

> **Advertise-and-skip is the only combination that can lie.**

| Advertised | Seam wired | Default mode | Strict mode |
|---|---|---|---|
| No | — | skip | fail (existing `behaviorGate` behavior) |
| Yes | Yes | run | run |
| **Yes** | **No** | **skip** | **FAIL (new)** |

An unadvertised capability stays a skip in default mode — a v1.0-only host is not newly broken. A host that advertises a capability and serves no seam has made a claim the suite cannot check, and under strict mode that is now a failure rather than a green. `OPENWOP_OPTED_OUT_PROFILES` remains available to any host that wants to be honest about not implementing something.

**This will newly fail hosts that were passing invisibly.** That is the entire point, and §Compatibility classifies it as a suite-version requirement rather than a spec requirement.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1 for the protocol: no schema changes, no endpoint contract changes, no event shape changes, no `MUST` relaxed. The differential contract binds a `/v1/host/sample/*` test seam, which is not protocol wire.

**Suite-version consequence, per `COMPATIBILITY.md` §2.3.** The G14 flip is *stricter than the spec text implies* — the spec has always required that an advertised capability be implemented; the suite simply failed to check it. It is therefore a **suite-version requirement**, not a new spec requirement, and hosts encounter it by upgrading the suite rather than by the protocol changing under them. A host that was strict-mode green on an earlier suite and advertises a capability it never wired will go red. It was always non-conformant; it is now visibly so.

## Conformance

New: `conformance/src/scenarios/pack-manifest-extension-opacity.test.ts`, gated on `behaviorGate` — never a silent skip in strict mode.

| Leg | Asserts | Discriminates |
|---|---|---|
| 1 | An extension-bearing manifest installs (`M′` accepted) | A host that rejects the hatch outright |
| 2 | An unextended manifest installs (`M` accepted) | Baseline; guards against a leg that passes because *everything* fails |
| 3 | **Projections for `M` and `M′` are equal** | **A host whose registration behavior is a function of the extension** — the load-bearing leg |
| 4 | A manifest carrying an extension whose value is markup / a templating directive installs, and its projection still equals the baseline | A host that interprets extension *values* at install |
| 5 | A misspelled canonical field is still rejected by the host, not just by the schema | A host that widened its own reader to `additionalProperties: true` to "support extensions" |

Leg 5 is included because a host can satisfy legs 1–4 by simply ignoring its manifest schema entirely. Accepting everything is not the same as accepting extensions.

### Measured, not asserted

Both mechanisms were verified against purpose-built stub hosts rather than reasoned about.

**The differential discriminates.** A stub whose install seam routes an unrecognized extension into a derived facet (`canvasComponents`) — the exact defect leg 3 exists to catch:

| Stub | Leg 1 | Leg 2 | Leg 3 | Leg 4 | Leg 5 |
|---|---|---|---|---|---|
| honest | ✅ | ✅ | ✅ | ✅ | ✅ |
| **violating** | ✅ | ✅ | ❌ | ❌ | ✅ |

**The violating host passes legs 1, 2, and 5.** That is the argument of §"Why presence is not the assertion", measured: a suite built only from presence assertions reports a clean green against a host that acts on extensions it does not recognize.

**The G14 flip discriminates.** A stub advertising `artifactTypes.supported` and `chat.cardPacks.supported` while serving no seam at all, across the new scenario plus the two flipped ones:

| Mode | Result |
|---|---|
| default | **9 passed** — a v1.0-only host is not newly broken |
| `OPENWOP_REQUIRE_BEHAVIOR=true` | **9 failed** — the advertise-and-skip lie is caught |

Before the flip, the strict-mode column read 9 passed.

### What this does NOT discriminate — stated, not discovered later

- **A host that stores the extension and interprets it at a moment the seam never reaches.** Leg 3 covers install-time sinks only.
- **Kinds without an install seam.** Only kinds whose seam returns a projection can run the differential. Kinds with no seam skip in default mode and fail in strict mode per the G14 table — which is honest, not covered.
- **The `artifact.created` witness (G8).** See below; explicitly out of scope.

### G8 is NOT in scope, and the reason is a measured constraint

RFC 0138's G8 records that `artifact.created` carrying `artifactType` — the fact the RFC 0138 replay correction rests on — is exercised only by `artifact-type-pack-install.test.ts`, one of the three G14 soft-skips.

It would be natural to scope its remedy onto the seam this RFC uses. **That does not work, and the reference host said so before it was asked:**

> My seam emits no `artifact.created`. This host emits it only from `feature.documents.nodes` inside a real run; `persistRunArtifact` explicitly does not. If G8's remedy is "a leg that proves the event carries `artifactType`", my current seam cannot provide the witness.

A witness for G8 needs either a seam that starts a real run, or the documents path driven end-to-end. That is a different piece of work with a different cost, and folding it in here would produce a leg that reports green without covering what G8 logged. G8 stays open and stays attributed.

## Alternatives considered

1. **Do nothing.** RFC 0138's normative "ignore means ignore" clause stays unverifiable against any host, and its invariant `pack-manifest-extension-opaque` remains enforced against the *corpus* rather than against *hosts*. Given that this exact hole hid a real `schemaRef` defect in a tier-1 host, leaving it is the option with a demonstrated failure history.
2. **Presence-only leg** (install extension-bearing manifest, assert 2xx). Cheap, and it would let the suite claim MUST-ignore coverage it does not have. Rejected in §Motivation: it passes the precise failure mode the rule exists to prevent.
3. **Sink enumeration** (assert the extension appears in no rendered surface). Requires the suite to know a host's sinks, which it cannot. Would produce a leg that is green because it looked in the wrong places.
4. **Flip G14 without the differential.** Makes the existing legs honest but adds no extension coverage. Worth doing, and this RFC does it — but alone it closes neither G6 nor G7.
5. **Differential without the G14 flip.** The new leg would itself soft-skip on any host that advertises without a seam, reproducing the bug it was written to fix. The flip is a precondition, not a bundled extra.

## Unresolved questions

1. **Projection equality is defined as "equal after removing the extension properties."** For a host that echoes its input manifest inside the projection, the removal rule must be recursive. Whether that is stated normatively or left to the suite's comparator is open — the suite comparator is the reference either way.
2. **Per-kind rollout.** This RFC lands the differential on the artifact-type seam, which is the one that exists and has a real host behind it. Whether `card`, `connection`, and `form-content` get the same leg, or whether one kind is a sufficient witness for a corpus-wide rule, is deferred to whether a second host wires a second seam.
3. **Should the projection become advertised surface?** It is deliberately a test seam here. If cross-host pack portability tooling ever wants it at runtime, that is a different RFC with a discovery story.
4. **Does leg 5 belong to this RFC or to RFC 0138?** It verifies RFC 0138's narrowness clause against a host rather than a schema. Placed here because it needs the same seam; arguable either way.

## Implementation notes (non-normative)

The suite side is a small delta on `conformance/src/lib/artifactTypes.ts`: `installArtifactTypePack` already posts to the seam and returns `{status, json}`. The differential needs the extension-injecting variant and a comparator that strips `^(x-|vendor\.)` keys recursively before comparing.

The host side is a small delta on an existing seam, per the reference host, which grounded its commitment in the architect review it ran when building the seam rather than implying a fresh derivation: route through the real loader, materialize the suite-supplied manifest to a temp dir so `schemaRef` resolution and the real rejection paths execute, env-gate it, and guard installs to a `vendor.conformance.*` prefix because `registerArtifactType` mutates a process-global registry with no tenant scoping.

That prefix guard is also why leg 3 is safe to run twice against a live registry.

**Sequencing.** The G14 flip and the differential leg should land together. Flipping first produces a window where hosts fail for a reason the suite cannot yet help them diagnose; adding the differential first produces a leg that skips on exactly the hosts it targets.

## Acceptance criteria

- [ ] Differential-install contract stated normatively in `spec/v1/node-packs.md`
- [ ] `pack-manifest-extension-opacity.test.ts` landed, gated on `behaviorGate`
- [ ] The three G14 scenarios flipped from bare `return` to `behaviorGate`, seam-absence included
- [ ] `conformance/coverage.md` documents the differential and what it does not discriminate
- [ ] CHANGELOG entry; suite minor bump with the three-way pin
- [ ] **Reference host wires the extended seam and reports per-leg results, including which assertions it does NOT discriminate** — the reporting standard agreed with the host, and the standard that would have surfaced G8 before RFC 0138's correction was written on top of an unpinned fact

## References

- RFC 0138 — the extension hatch, its normative "ignore means ignore" clause, and gaps G6/G7/G8
- `spec/v1/node-packs.md` §"Vendor extensions on pack manifests"
- `SECURITY/invariants.yaml` — `pack-manifest-extension-opaque`, currently enforced against the corpus only
- `conformance/coverage.md` §"Capability-gated scenarios: shape vs behavior", §"Open seams"
- `conformance/src/lib/behavior-gate.ts` — the gate this RFC extends to seam-absence
- `COMPATIBILITY.md` §2.1 (additive), §2.3 (suite stricter than spec)
- openwop-app#3013 — the architect review the seam design rests on; #3026/#3027/#3030 — RFC 0138 host adoption
