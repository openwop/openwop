# OpenWOP Compatibility Commitment

> **Status:** v1 and v2 — §1–§4 and §6–§8 apply to the locked v1 contract and all subsequent v1.x releases; §2.4 and §3a state how they apply to v2.x.

This document defines what openwop guarantees about backward compatibility, when those guarantees can be relaxed, and how implementers should pin against the spec.

In short: **a major is additive-only, with one explicit exception for safety and security fixes.** Everything else that would break a conformance pass goes to the next major.

## 1. Versioning model

The additive-only guarantee runs from **2026-05-08**, the day the v1 wire contract froze (`CHANGELOG.md` `[1.0] — 2026-05-08`). Everything after that date is additive per §2, or a safety fix per §3. The first registry publication (2026-05-11) and the v1.0 close-out release (2026-05-12) came later and do not govern this document.

openwop uses three independent version axes:

| Axis | Range | Bump rule |
| --- | --- | --- |
| **Spec corpus version** (e.g. `v2`, `v2.1`) | Major.Minor | Major = breaking; Minor = additive |
| **Conformance suite version** (`@openwop/openwop-conformance`) | Major.Minor.Patch | Major tracks spec major; Minor adds scenarios for the same spec major; Patch yanks/fixes scenarios |
| **SDK versions** (`@openwop/openwop`, `openwop-client`, Go SDK) | Major.Minor.Patch | Major tracks spec major; Minor adds methods or fixes types; Patch is bug fixes |

Two SDK rules for retiring v2 surfaces:

- A type for a retired optional v2 surface is marked `@deprecated` in a minor and removed only at the SDK major.
- A pack-author API whose return shape changes gets a new method name.

A host advertises:

- The spec major it implements (via `protocolVersion` in `/.well-known/openwop`).
- The conformance suite version it passes (recorded in its certification bundle; see `INTEROP-MATRIX.md`).
- Optionally, the profile set it advertises (v2 profiles are defined in `spec/v2/profiles.json`).

Clients and SDKs pin to the spec major. Within a spec major, clients are guaranteed forward compatibility per §2.

## 2. v1.x compatibility guarantees

For any release `v1.x` (where `x ≥ 0`):

### 2.1 Additive only

- New optional fields MAY appear in request and response bodies, event payloads, and the discovery document.
- New event types MAY appear in event streams. Clients MUST ignore unknown event types.
- New `SHOULD` recommendations MAY be introduced. Hosts that don't follow new `SHOULD`s remain conformant against the suite version they pass; later suite versions may not pass.
- New optional capabilities MAY be added to `/.well-known/openwop`. Hosts that don't advertise them remain v1-compliant.
- New endpoints MAY be added under `/v1/`. Existing endpoints MUST continue to work as documented.
- New conformance scenarios MAY be added in suite minor releases. Hosts that pass `1.0` are not required to pass `1.x.0`; they advertise the suite version they pass.

#### Schema closure (RFC 0094)

How a published JSON Schema treats undeclared properties is a compatibility decision, and the rule differs by direction of travel:

- **Client-submitted shapes are closed.** Schemas validating client-submitted request bodies MUST be closed at the **outermost composition**, so client typos fail fast instead of being silently dropped:
  - on a standalone object schema, with `additionalProperties: false`;
  - when the request shape is an `allOf` composition (JSON Schema 2020-12), with `unevaluatedProperties: false` at the composition site.
- Closure MUST NOT be placed inside individual `allOf` branches (that composition is unsatisfiable).
- **Server-emitted shapes are open.** Schemas describing server-emitted documents (events, snapshots, discovery payloads) MUST NOT be closed, so a v1.x host can add optional fields per §2.1 without breaking schema-validating clients.

Under this policy `schemas/run-event.schema.json` is open, with an `anyOf` vendor-event branch on `type`, and the `createRun` request composition is closed via `unevaluatedProperties: false`. Opening the remaining server-emitted schemas is a named follow-up of RFC 0094 (§Unresolved questions).

#### Cross-file `$ref` in a published schema (2026-08-16)

Adding a **new cross-file `$ref`** to a published schema (e.g. `workflow-definition.schema.json` gaining `"$ref": "compensation-policy.schema.json"`) is **additive on the wire** and **a suite-minor change for validators**. A consumer that pre-registers a *fixed list* of peer schemas before `compile()` throws at compile time until it registers the new peer, and a runner that resolves the sibling corpus while pinning an older suite fails for a change it did not make. Rules:

- A schema author adding a cross-file `$ref` MUST bump the conformance suite minor and MUST list the new peer in the CHANGELOG entry (as #1009 did for `compensation-policy.schema.json`).
- Consumers SHOULD register schemas by **enumerating the schema directory** rather than by a fixed list, as the suite's own validators do (`fixtures-valid.test.ts`, `workflow-primary-output-annotation.test.ts`). A fixed list is a claim about the schema graph that nothing keeps true.
- Where a schema must stay self-contained for downstream fixed-list validators (registry-side manifest validation), prefer an **inline byte-mirror with a conformance leg asserting equality to the source** over a `$ref`, as RFC 0157 did for the chain manifest.

### 2.2 Never within v1.x

- Existing required fields MUST NOT become optional, MUST NOT be removed, MUST NOT change type.
- Existing optional fields MUST NOT change type.
- Existing event types MUST NOT change shape.
- Existing endpoints MUST NOT change request or response contracts (additive optional fields aside).
- Existing `MUST` requirements MUST NOT be relaxed.
- Existing error codes and HTTP status codes MUST NOT change meaning.

### 2.3 Suite vs. spec compatibility

A new conformance scenario that fails on a host previously passing `1.x.0` does NOT mean the spec broke. It means the suite found a previously-untested gap. The host's `1.x.0` pass is preserved; the host has the option to fix and pass `1.(x+1).0`.

The suite is the test instrument; the spec is the contract. Suite changes MAY be more strict than spec text about edge cases, but MUST NOT be more strict about wire shape than the spec defines.

**Measurement vs. claim (RFC 0148).** A recorded `1.x.0` pass is a *measurement* and is preserved as such. A *certification claim* is governed by RFC 0148:

- Certification bundle **v2** (suite ≥ `1.114.0`) records one of five dispositions per requirement, with a witnessed assertion count.
- Bundle **v1** could not tell `skipped` from `inapplicable` from `blocked`, and its `passed` list counted an early-returning test as a pass. It remains parseable but **ceases to substantiate a new certification after the 90-day migration window** that began 2026-08-12. RFC 0148 classifies this as a `safety-fix` under §3.
- Suites before `1.114.0` are still valid instruments for what they measured; they are not evidence of what they could not observe.

### 2.4 v2.x (RFC 0197)

§2.1–§2.3 apply to every v2.x release, with v2 schemas closed by default (`spec/v2/core/overview.md` Axiom 3). The RFC 0094 "server-emitted shapes are open" rule is a v1 rule.

- **Adding an OPTIONAL property to a closed v2 object is additive.** A consumer validating against an older schema version is validating against that version, and SHOULD pin it (`spec/v2/core/versioning.md` §4) rather than expect forward-open objects.
- **Adding a REQUIRED property, closing an open object, or narrowing a type is a major.**
- Removal is governed by §3a; no v2 surface is reshaped in place.

Precedents: RFCs 0183, 0186 and 0188, and the 2026-09-20 correction on record (§3).

**Maturity ceiling (RFC 0197 §C).** A host MUST NOT advertise `status: "stable"` for a family whose `spec/v2/declaration.json` row is not `technical: "stable"` (`spec/v2/core/capabilities.md` §8). Advertising below a `stable` row is permitted.

- This tightens what a record may claim, so it is not additive under §4. It binds by suite release, following the §2.3 measurement rule.
- It is a MUST for every bundle cut on the first suite release that ships RFC 0197 or a later one.
- A committed bundle cut on an earlier suite stays a valid measurement at its suite version: it is **reported** as overstating, not failed (steward decision D1, 2026-09-22). Owed re-cuts are tracked as gap `openwop.gap.0197.1`.
- No family is promoted to `stable` by this rule; promotion is a per-family evidence decision by RFC.

## 3. The safety-fix exception

The §2.2 list above has one explicit exception: **safety and security fixes.**

A change MAY break v1.x if all of:

- It is necessary to fix a CVE-class vulnerability or a correctness bug that prevents the protocol from being used safely.
- The fix cannot be expressed as additive (e.g., a new optional field) without leaving the original surface insecure or incorrect.
- The fix is published with one of:
  - **A 90-day public RFC window** (per `RFCS/0001-rfc-process.md`) before merge; OR
  - **An embargoed coordinated-disclosure window** per `SECURITY.md`. The RFC is published when the embargo lifts. Embargo MUST NOT exceed 90 days unless implementers operating production deployments need more time and explicitly request the extension.

Safety-fix breaks ship with:

- An RFC documenting the change, the threat model, and the migration path.
- A `version-negotiation.md` runbook section describing how implementers detect the change and migrate.
- Migration tooling where mechanically possible (codemods, schema migrators, conformance scenarios that detect the old surface).
- A `CHANGELOG.md` entry under a `### Security` heading citing the advisory ID per `SECURITY.md`.

The spec major does **not** bump for safety-fix changes. The spec minor bumps. The suite minor bumps with new scenarios that detect both the vulnerable shape and the fixed shape.

A safety-fix change is the only category that can break v1.x. Everything else goes to v2.

**Corrections and safety-fix classifications on record** — every dated editorial, conformance-affecting and evidence correction, and every safety-fix classification — are kept in [`docs/COMPATIBILITY-CORRECTIONS-LOG.md`](./docs/COMPATIBILITY-CORRECTIONS-LOG.md).

## 3a. Retiring a v2 surface within the major (RFC 0197)

The rule is `spec/v2/core/overview.md` §0a; RFC 0197 §A states the six predicates the retirement gate reports.

- A retirement narrows emission; readers keep accepting persisted shapes for the life of the major.
- `minClientVersion` MUST NOT be used to force a shape, because it refuses the whole client with `426`.
- A Class 3 correction that changes a v2 shape is recorded as a row in `spec/v2/corrections.json` and passes the same bundle and registry scan.
- **Until the RFC 0197 gates (`check-v2-retirement.mjs`, `check-v2-surface-monotone.mjs` and the minor-aware `check-removal-dates.mjs`) run in `npm run openwop:check`, no v2 surface is removed inside the major; every v2 removal waits for 3.0.**

The precedents the rule writes down:

- **P1** — 2.8.2 removed two `workflowChainPacks` facets in a patch, and a committed bundle then failed `capabilities-root-closed`, because no gate scanned bundles.
- **P2** — 2.10 held `packs.testMode` and `observability.testSeams` to 3.0 because live bundles carry them.
- **P3** — the 2.32.0 `signing` correction (in the corrections log): a Class 3 shape change is allowed only when nothing conforming stops conforming.

## 4. Behavior-only changes

Some changes don't touch wire shapes but change observable behavior:

| Change | Allowed in v1.x? |
| --- | --- |
| New optional capability advertised, off by default | Yes — additive |
| Existing optional capability becomes default-on (changes observed behavior on hosts that didn't advertise it) | Only via safety-fix process |
| Performance improvement that changes observed timing | Yes — timing is outside compatibility unless `scale-profiles.md` documents it |
| Stricter validation rejecting input that previously succeeded | Only via safety-fix process |
| Looser validation accepting input that previously failed | Yes — additive (clients that sent invalid input were already broken) |
| New normative requirement on a previously-undefined behavior | Yes — additive (the spec was previously silent) |

When in doubt, file an RFC and let the comment window surface compatibility concerns.

## 5. v2 plan

The v1 contract is locked. Any change that:

- Removes or renames an existing required field; or
- Changes an existing field's type, semantics, or required/optional status; or
- Changes an existing event type's shape; or
- Removes or changes an existing endpoint's contract beyond additive fields; or
- Deprecates an existing capability such that clients pinned to v1.x cannot continue to operate

ships as part of the v2 spec major. A v2 RFC must include:

- A migration plan for v1.x implementers.
- A coexistence plan: how v1 and v2 servers/openwops interoperate during the transition (typically a discovery field that advertises support for both).
- A deprecation timeline for v1, computed by the **host-inventory rule** below rather than by a fixed calendar.
- An updated conformance suite major (`@openwop/openwop-conformance@2.0.0`).

v1.x and v2 ship as parallel tracks. v1.x continues to receive additive and safety-fix releases until the v1 deprecation date.

**Host-inventory rule for the v1 deprecation date.** v1 support ends at the *later* of:

1. **Every host listed in [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) has published a non-vacuous v2 certification bundle** (a bundle whose claimed profiles are witnessed by executed assertions on a deployed origin, per RFC 0148), **plus 90 days**; and
2. **18 months from the v2 release**, *if and only if* the matrix lists at least one host operated by an organization other than the steward at the time v2 is released.

The project is operated by a single steward (`GOVERNANCE.md` §"Sole-steward operation"), so a fixed calendar window would delay v2 without protecting anyone. Clause 2 protects an independent host the day one appears, without a further amendment. `spec/v2/core/overview.md` §"v1 end-of-support" states the rule normatively, and `evidence/v1-end-of-support.json` computes the date.

## 6. Pinning recommendations

### For host implementers

- Advertise the highest spec minor your host passes. Don't hide additive capabilities to "stay compatible" — additive capabilities ARE the compatibility model.
- Pin the conformance suite version you pass in your README. Re-run the suite per release; if a suite minor breaks your host, decide whether to fix or to keep pinning to the older suite version.
- Subscribe to `RFCS/` for normative additions before they ship.

### For client implementers

- Pin SDK to the spec major you target (`@openwop/openwop@^2.0` for v2.x, `@openwop/openwop@^1.0` for v1.x).
- Treat unknown fields and unknown event types as forward-compat extensions (ignore them).
- Read `CHANGELOG.md` between SDK upgrades for any safety-fix advisories.

### For application authors building on a host

- Pin to the host's advertised conformance suite version, not to the spec version directly. The host knows what it implements.
- Use the host's discovery document (`/.well-known/openwop`) to detect optional capabilities. Don't assume capabilities the host hasn't advertised.

## 7. Deprecation policy

The §2.2 prohibitions apply to deprecation as well: an existing surface MAY be marked `deprecated` in spec text and SDK output, but MUST continue to behave as documented through the v1 lifecycle. Deprecation flags signal "this will be gone in v2"; they don't trigger v1.x removal.

A deprecation in v1.x requires:

- An RFC explaining the planned v2 replacement.
- A spec annotation (`> Deprecated: …`) that points to the RFC.
- An SDK warning (where the SDK can detect use of the deprecated surface).
- A `CHANGELOG.md` entry under `### Deprecated`.

Deprecated surfaces continue to pass conformance. The `Deprecated:` annotation is informational, not normative.

**Deprecation register.** [`spec/v1/deprecations.json`](./spec/v1/deprecations.json) lists every surface that an RFC or a spec annotation has deprecated, with its authority, replacement, and scheduled removal version. Its schema is [`spec/v1/deprecations.schema.json`](./spec/v1/deprecations.schema.json), and `scripts/check-deprecations.mjs` checks it in `npm run openwop:check`.

- In v1.x the register is an **index**, not a source of obligations: it records deprecations the RFC process has already made and never creates one.
- Entries carry `status: "deprecated"` only when an RFC or annotation exists. Surfaces the v2 program *proposes* to deprecate carry `status: "proposed"` with `deprecatedIn: null`, so a reader can tell the two apart.
- The v2 major makes the register normative (removal dates enforced at merge).

**v2.x (RFC 0197).** A `v2-minor` deprecation row (`removalTrigger: "v2-minor"`, `removeIn: "2.N"`) schedules a removal inside the major.

- It is enforced by the minor-aware `check-removal-dates.mjs` against `spec/v2/release.json`, and admitted only when `check-v2-retirement.mjs` passes (§3a).
- Until both run in `npm run openwop:check`, §3a's hold applies and no such row may fall due.
- Every other v2 deprecation removes at `3.0`.

## 8. What this document doesn't cover

- **Implementation-internal contracts.** A host's storage format, internal API, or RPC shape is the host's call. Compatibility within a host's implementation is the host's responsibility.
- **Non-normative spec text.** "Why this exists," examples, reference notes — these may change freely. Compatibility applies only to normative requirements (`MUST`/`SHOULD`/`MAY`).
- **Conformance fixture wording.** Fixture names and human-readable descriptions are not part of the wire contract.

## 9. References

- `GOVERNANCE.md` — decision rules; this document tells maintainers what counts as additive vs. breaking.
- `RFCS/0001-rfc-process.md` — the RFC mechanism through which compatibility-affecting changes ship.
- `SECURITY.md` — embargoed disclosure process referenced by the §3 safety-fix exception.
- `ROADMAP.md` — what's planned; references this document for the change-class definitions.
- `MAINTAINERS.md` — who has authority to merge changes that affect this commitment.
- [`docs/COMPATIBILITY-CORRECTIONS-LOG.md`](./docs/COMPATIBILITY-CORRECTIONS-LOG.md) — the dated corrections on record under §3.
