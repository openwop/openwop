# Migrating from OpenWOP v1 to v2

> **This is not an additive upgrade.** v2 is a new major with its own path space, its own identifier grammars, and its own discovery representation. Unlike [v1.0 → v1.1](./v1.0-to-v1.1.md), which required no code changes, every host that serves v2 mounts new surface and changes the shape of ids it emits. Read [`COMPATIBILITY.md`](../../COMPATIBILITY.md) §5 and [`spec/v2/core/versioning.md`](../../spec/v2/core/versioning.md) before starting.

> **Status: in flight.** The v2 charter's Phase 5 exit requires this guide to cite **both hosts' PR series**. The series are cited below as they stand on 2026-09-05 — merged items by number, open items marked open — and the guide is complete on this point only when both hosts' origin bundles are in the INTEROP-MATRIX v2 table. It is published now because its contents are what the migrations have *already* cost, and a host starting today should not have to rediscover them. The PR series land when the hosts do.

## Why this doc exists, and what it is written from

Two production hosts migrated first: **openwop-app** (tier-1) and **MyndHyve** (tier-2). Between them the migration surfaced **26 corpus defects** — not host bugs, defects in the specification and its checks — and the useful content of this guide is what those cost, rather than the order the phases were meant to happen in.

Almost none of the time went where a plan would have put it. Mounting the v2 path space was mechanical. What consumed days was a specific, repeating shape:

> **A signal that reads the same whether it is true or false.**

Every section below that begins *"what this actually cost"* is an instance. If you are migrating a host, those sections are the ones to read twice; the surface enumeration you can get from the spec.

---

## The overlap: what a dual-stack host owes

Through the overlap a host advertises both majors, emits `OpenWOP-Version` on every response, and serves `/.well-known/openwop` as one resource whose representation the request header selects.

### Identifiers change shape, and the change reaches further than responses

Under major 2 a `runId` is **tenant-bound** — `<tenantId>/<opaque>` ([`identity.md`](../../spec/v2/core/identity.md) §5). A run minted under major 1 and read under major 2 MUST be named by its tenant-bound **projection** ([`versioning.md`](../../spec/v2/core/versioning.md) §5).

The projection is mandatory rather than optional for a reason worth internalising before you implement it: §5 requires a host to refuse a tenant-bound id whose tenant segment is not the caller's, `403 id_tenant_mismatch`. **A bare id has no tenant segment, so that check cannot run on it at all.** A legacy unprefixed form would exempt precisely the longest-lived ids in the system — the ones carried over from v1 — from major 2's tenant isolation.

**What this actually cost.** The tier-1 host implemented the projection as *"a reversible projection at the major-2 boundary, applied by both JSON senders."* That sentence is the defect written down as the design. It is reversible **on the paths someone remembered to route through it**, and the webhook emitter is not a JSON sender — it is an outbound HTTP call. So subscribers received the **bare** id while the client held the **projected** one:

```js
const runId = (create.json).runId;                    // "default/<uuid>"
const ours = () => receiver.attempts.filter(a => a.runId === runId);
```

Zero matches. **No error, no 4xx, no log line.** The host's own 228 lines of new tests all passed, because they tested the projection function, which was correct.

> **Do not add a call site. Add a seam every emitter must pass through.** Adding a third sender to *"applied by both JSON senders"* reproduces the defect with a larger number in it.

The sites are not obvious from the endpoint list. As of suite `2.0.0-rc.31`, `spec/v2/id-field-bindings.json` binds these run-shaped fields to the tenant-bound kind: `childRunId`, `parentRunId`, `sourceRunId`, `baselineRunId`, `enqueuedRunId`, `evalRunId`. **Every one is a place the projection has to reach.** `childRunId` in particular sat unbound in the corpus for the whole of v2's construction, in the same file where `parentRunId` was correctly bound.

### Both header families, through the overlap

A host advertising both majors MUST send the `X-openwop-*` family alongside `OpenWOP-*` with identical values on every webhook delivery, and a v2 receiver MUST accept a delivery carrying only `X-openwop-*` under scheme `v1` ([`webhooks.md`](../../spec/v2/core/webhooks.md) §Dual emission). This adds no signature scheme. Per-subscription secrets are unchanged across the cut.

### Era stamping

Run documents carry an era key. Absent means era 2 (v1); `3` means the v2 era. The reader rule, the writer rule, and the deliberate absence of any backfill are in [`persistence.md`](../../spec/v2/core/persistence.md).

**What this actually cost.** Both production hosts were measured and **neither stamped `eventLogSchemaVersion` on any run it had ever served** — a v1 `MUST` since the contract was written, which nothing in the suite had ever asserted. The failure direction is what makes it worth your attention: a client following the legacy-detection rule exactly classifies every such run as legacy and reads the snapshot, **ignoring the event log the host is in fact serving.** The host under-serves the conforming reader and over-serves the careless one.

---

## Running the conformance suite against a v2 host

### Set the target major, or measure nothing

`--target-major 2` selects the v2 scenario set. **This is the single highest-cost misconfiguration in the migration**, and it does not announce itself.

**What this actually cost.** The tier-1 host's runner never set it, so it defaulted to `1`, and the v2 scenarios ran with **major-1 requests**. The scenarios' own gates call `v2Discovery()`, which sets the header *explicitly* — so **the gate passed and the probe went out as v1.**

> The applicability check and the assertion ran under **different contracts**. A scenario proved the host speaks v2 with one request, then tested a v2 requirement with a request that did not.

Three "host defects" were reported to me from that run. All three evaporated at major 2. The host was one edit from "fixing" an auth allowlist for behaviour that was correct at both majors. Re-run correctly: **53 of 57 v2 scenarios passed**, and a PR believed to be net-negative turned out to close five.

The inverse error is equally available: flipping the driver's header behaviour **without** the file selection sends every v1 scenario to `/v1/…` with a v2 header, hitting the correct `protocol_version_mismatch` refusal, and produces ~74 failing files that are all your own configuration. The same session made both mistakes twenty minutes apart, in opposite directions.

**Check what your measurement is measuring before you act on it.** That sentence is the whole of this section.

### A bundle can pass by asserting nothing

Dispositions are `executed-pass | executed-fail | skipped | inapplicable | blocked`. A scenario that cannot run returns `blocked`, and **a bundle with blocked rows does not certify** (RFC 0168 §E.1).

**What this actually cost.** A named exit-criterion scenario "passed" while both of its requirement rows were `blocked` — it was seam-gated, and the host advertised `conformance: {}`. The output said `2 passed`. Only the disposition ledger said `blocked 3`.

> Read the ledger, not the pass count. **A vacuous pass and a real one print the same word.**

There is a second distinction the runbook now makes explicitly, because a day was lost to conflating them: **"not mounted" is a deployment condition; "not built" is a build task.** The canonical `/conformance/seams` surface was assumed to be the former for some time. It was the latter.

---

## Packaging: which suite versions you can actually install

**`@openwop/openwop-conformance` versions `2.0.0-rc.20` through `2.0.0-rc.28` are permanently uninstallable.** They pin `peerDependencies['@openwop/spec-artifacts']` to an exact version that was never published, and fail `ERESOLVE` for any consumer. They cannot be repaired in place — npm versions are immutable.

**The floor is `2.0.0-rc.29`.** If you are pinned inside that range you cannot upgrade in place; move the pin.

**What this actually cost.** The two packages version in lockstep but published on independent tags, and only one tag was ever pushed. It survived nine releases because **every gate ran inside a checkout of the spec repo**, where the peer resolves from the monorepo whether or not it exists on the registry. Even the byte-identity check — which compares the published tarball to the tree — never asked whether the tree's dependencies could be *obtained*.

> The workspace witnesses what the code does. **npm witnesses what a consumer can obtain.** A publish is a claim about the second, and a green run in the first cannot make it.

A tier-1 host found it the only way it can be found: by trying to install the thing we said was ready.

---

## Where the corpus was wrong, and how to tell

Four of the 26 defects share one root, and recognising it will save you filing a bug against your own host:

| shape | what it does to you |
|---|---|
| a **check tighter** than the prose it cites | fails your host **for obeying the rule** |
| a **schema looser** than its prose | licenses the state the rule exists to detect |
| a rule expressed **only as a `$ref`** | invisible to anyone reading the prose |
| a gate that runs **only in the workspace** | cannot witness what a consumer obtains |

All four are the artifact and the sentence drifting apart with nothing standing where they meet.

**The one to expect first.** `v2-dual-stack-negotiation` asserted that a cross-major read returns the v1 id **byte-identical**, citing `versioning.md` §5 — which described the scenario's *shape* and said nothing about identifiers. A host implementing `identity.md` §5 faithfully could not satisfy it. The tier-1 host hit this and **reported it as its own regression** rather than filing a corpus bug to excuse a broken PR. That instinct is the right one and it still cost time.

> If a scenario fails your host and you believe the host is right, **read the section the assertion cites and check that it says what the assertion asserts.** Twice in this migration it did not.

File it. A corpus defect found by a host is worth more than one found by its author, because it was found by someone who could not have written it in.

---

## Upgrading

```bash
# TypeScript
npm install @openwop/openwop-conformance@^2.0.0-rc.31

# the contract package is an exact peer and ships with it — do not pin it separately
```

Verify from **outside your repo**, in an empty directory, before you trust a version:

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm install @openwop/openwop-conformance@<version>
```

## The two migrations, as PR series

What each host actually shipped, in order, with what each PR was for. Numbers are the hosts' own repositories; "open" means not merged as of 2026-09-05.

**openwop-app** (tier-1, `github.com/openwop/openwop-app`; served through a hosting layer in front of the service):

| PR | What it carried | Lesson it paid for |
| --- | --- | --- |
| #3639 | tenant-bound id projection on the major-2 read path | merged from a pre-rebase head, so main carried the projection without the webhook seam — the seam is a precondition, not decoration |
| #3642 | the webhook delivery seam at `enqueueDelivery`, inbound §5 id grammar, suite re-pinned | the delivery envelope had no schema while the nested `runId` was bound all along |
| #3647 (ADR 0631) | origin path space: 26 hosting sources generated from the manifest; the negotiator hands headerless HTML navigations to the shell; `verify-deploy.sh` probes a root at the origin | fourteen of fifteen major-2 roots fell through to the SPA shell while the direct service URL answered every path — the direct-URL witness could not see it |
| #3648 (open) | the hosting layer decoded `%2F` to `/` before forwarding, so every tenant-bound id was unreachable at the origin; `eventsUrl`/`statusUrl` pointed at the service's own hostname over `http` | "a hosting layer is part of the wire" — every id encoding and every absolute URL must be witnessed through the origin a client is given |
| ADR 0623 | RFC 0164 mandatory leaver contract | — |

**MyndHyve** (tier-2, `workflow-runtime`, PR #249 on `wop/v2-wire`; no hosting layer, the service is the origin):

| Change | What it carried | Lesson it paid for |
| --- | --- | --- |
| `e3771c77b` | payload key-map at the storage seam: drops only, `nodeType → typeId`, `owner.principal` deleted | seats for dropped keys are the next edit, not an afterthought |
| `7ce20d341` | `projectRunCreateV2`: the create response carried a bare id and a `/v1/canvases/…` `eventsUrl` | the create response is part of the id projection |
| `e49648bbd` | error-code projection (rename table plus `myndhyve.<code>`) | the pass-through branch was the defect |
| `3bf431aa4` | the Express JSON parser was mounted before negotiation, so a malformed body escaped to a framework HTML 400 with no header under both majors | the one request no scenario sends by accident |
| `c1f63ee5a` | suite re-pinned to `2.0.0-rc.44`; registry 94 → 96 (`payload_too_large`, `unsupported_media_type` bare on the wire) | a code claiming to be protocol must be in the registry |

Both hosts' first major-2 bundles carried blocked rows from the unbuilt `/conformance/seams` surface and certified nothing; that is the true state of the evidence, not a defect in the emitter.

## See also

- [`docs/runbooks/V2-HOST-MIGRATION.md`](../runbooks/V2-HOST-MIGRATION.md) — the operational runbook these lessons were first recorded in
- [`COMPATIBILITY.md`](../../COMPATIBILITY.md) §5 — the v1/v2 coexistence contract
- [`spec/v2/core/versioning.md`](../../spec/v2/core/versioning.md) — the overlap, the path space, the projection rule
- [`spec/v2/core/identity.md`](../../spec/v2/core/identity.md) §5 — identifier grammars and the binding rule
- [`INTEROP-MATRIX.md`](../../INTEROP-MATRIX.md) — who has produced a v2 bundle
