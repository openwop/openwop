# OpenWOP Compatibility Commitment

> **Status:** applies to every released major. v2 is the current major. v1 reached end of support on 2026-10-04 ([RFC 0234](./RFCS/0234-maintainer-set-v1-end-of-support.md)); its tree is frozen.

This document defines what OpenWOP guarantees about backward compatibility, when those guarantees can be relaxed, and how implementers should pin against the spec.

In short: **a major is additive-only, with one explicit exception for safety and security fixes.** Everything else that would break a conformance pass goes to the next major. v2 adds one narrow, gated way to retire an unused surface inside the major (§3a).

## 1. Versioning model

Each major is additive-only from its release. v1's wire contract froze on 2026-05-08; v2.0.0 was tagged on 2026-09-05.

OpenWOP uses three independent version axes:

| Axis | Range | Bump rule |
| --- | --- | --- |
| **Spec corpus version** (e.g. `v2.45.0`) | Major.Minor.Patch | Major = breaking; Minor = additive |
| **Conformance suite version** (`@openwop/openwop-conformance`) | Major.Minor.Patch | Major tracks the spec major; Minor adds scenarios for the same spec major; Patch fixes scenarios |
| **SDK versions** (`@openwop/openwop`, `openwop-client`, Go SDK) | Major.Minor.Patch | Major tracks the spec major; Minor adds methods or fixes types; Patch is bug fixes |

Two SDK rules for retiring v2 surfaces:

- A type for a retired optional v2 surface is marked `@deprecated` in a minor and removed only at the SDK major.
- A pack-author API whose return shape changes gets a new method name.

A host advertises:

- The spec majors it implements, in `protocolVersions[]` of `/.well-known/openwop` ([`spec/v2/core/versioning.md`](./spec/v2/core/versioning.md) §1).
- The conformance suite version it passes, recorded in its certification bundle (see `INTEROP-MATRIX.md`).
- Optionally, the profiles it claims (v2 profiles are defined in `spec/v2/profiles.json`).

Clients and SDKs pin to the spec major. Within a major, clients are guaranteed forward compatibility per §2.

## 2. Compatibility within a major

For every release inside a major (`N.x`, for any `x`):

### 2.1 Additive only

- New optional fields MAY appear in request and response bodies, event payloads, and the discovery document.
- New event types MAY appear in event streams. Clients MUST ignore unknown event types.
- New `SHOULD` recommendations MAY be introduced. A host that doesn't follow a new `SHOULD` remains conformant against the suite version it passes; a later suite version may not pass.
- New optional capabilities MAY be added to `/.well-known/openwop`. A host that doesn't advertise them remains conformant.
- New endpoints MAY be added. Existing endpoints MUST continue to work as documented.
- New conformance scenarios MAY be added in suite minor releases. A host that passes `N.0` is not required to pass `N.x`; it advertises the suite version it passes.

#### Schema closure

How a schema treats undeclared properties is a compatibility decision.

- **v2: closed by default.** Every v2 object schema is `additionalProperties: false` ([`spec/v2/core/overview.md`](./spec/v2/core/overview.md) Axiom 3). §2.4 says what that means for additions.
- **v1 (RFC 0094).** Client-submitted shapes are closed at the outermost composition (`additionalProperties: false`, or `unevaluatedProperties: false` on an `allOf`), never inside an `allOf` branch. Server-emitted shapes (events, snapshots, discovery) are open, so a v1 host could add optional fields.

#### Cross-file `$ref` in a published schema

Adding a **new cross-file `$ref`** to a published schema is **additive on the wire** and **a suite-minor change for validators**. A consumer that pre-registers a fixed list of peer schemas before compiling fails until it registers the new peer.

- A schema author adding a cross-file `$ref` MUST bump the conformance suite minor and MUST name the new peer schema in the CHANGELOG entry.
- Consumers SHOULD register schemas by **enumerating the schema directory**, as the suite's own validators do, rather than by a fixed list.
- Where a schema must stay self-contained for fixed-list validators (for example registry-side manifest validation), prefer an **inline copy with a conformance check that it equals the source** over a `$ref`.

### 2.2 Never within a major

- Existing required fields MUST NOT become optional, MUST NOT be removed, MUST NOT change type.
- Existing optional fields MUST NOT change type.
- Existing event types MUST NOT change shape.
- Existing endpoints MUST NOT change request or response contracts (additive optional fields aside).
- Existing `MUST` requirements MUST NOT be relaxed.
- Existing error codes and HTTP status codes MUST NOT change meaning.

### 2.3 Suite vs. spec compatibility

A new conformance scenario that fails on a host that passed `N.x.0` does not mean the spec broke. It means the suite found a previously untested gap. The host's `N.x.0` pass stands; the host can fix the gap and pass a later suite.

The suite is the test instrument; the spec is the contract. The suite MAY be stricter than spec text about edge cases, but MUST NOT be stricter about wire shape than the spec.

**Measurement vs. claim (RFC 0148).** A recorded pass is a *measurement* at the suite version that made it, and it stays a valid measurement at that suite. A *certification claim* is governed by RFC 0148:

- Certification bundles from suite `1.114.0` on record one of five dispositions per requirement (`executed-pass`, `executed-fail`, `skipped`, `inapplicable`, `blocked`), with a witnessed assertion count.
- Bundle v1 could not tell `skipped` from `inapplicable` from `blocked`, and counted an early-returning test as a pass. It remains parseable but ceases to substantiate a new certification after the 90-day migration window that began 2026-08-12. RFC 0148 classifies this as a safety fix under §3.
- An older suite is still a valid instrument for what it measured; it is not evidence of what it could not observe.

### 2.4 v2 specifics (RFC 0197)

§2.1–§2.3 apply to every v2 release, with v2 schemas closed by default.

- **Adding an OPTIONAL property to a closed v2 object is additive.** A consumer validating against an older schema version is validating against that version, and SHOULD pin it ([`spec/v2/core/versioning.md`](./spec/v2/core/versioning.md) §4) rather than expect forward-open objects.
- **Adding a REQUIRED property, closing an open object, or narrowing a type is a major change.**
- Removal is governed by §3a; no v2 surface is reshaped in place.

Precedents: RFCs 0183, 0186 and 0188, and the 2026-09-20 correction on record (§3).

**Maturity ceiling (RFC 0197 §C).** A host MUST NOT advertise `status: "stable"` for a family whose `spec/v2/declaration.json` row is not `technical: "stable"` ([`spec/v2/core/capabilities.md`](./spec/v2/core/capabilities.md) §8). Advertising below a `stable` row is permitted.

- This tightens what a record may claim, so it is not additive under §4. It binds by suite release, following the §2.3 measurement rule.
- It is a MUST for every bundle cut on the first suite release that ships RFC 0197, or a later one.
- A committed bundle cut on an earlier suite stays a valid measurement at its suite version: it is **reported** as overstating, not failed. Owed re-cuts are tracked as gap `openwop.gap.0197.1`.
- No family is promoted to `stable` by this rule; promotion is a per-family evidence decision by RFC.

## 3. The safety-fix exception

The §2.2 list has one explicit exception: **safety and security fixes.**

A change MAY break a released major if all of these hold:

- It is necessary to fix a CVE-class vulnerability or a correctness bug that prevents the protocol from being used safely.
- The fix cannot be expressed additively (for example as a new optional field) without leaving the original surface insecure or incorrect.
- The fix is published with one of:
  - **A 90-day public RFC window** (per `RFCS/0001-rfc-process.md`) before merge; or
  - **An embargoed coordinated-disclosure window** per `SECURITY.md`. The RFC is published when the embargo lifts. The embargo MUST NOT exceed 90 days unless implementers operating production deployments need more time and explicitly request an extension.

Safety-fix breaks ship with:

- An RFC documenting the change, the threat model, and how implementers detect the change and migrate.
- Migration tooling where mechanically possible (codemods, schema migrators, conformance scenarios that detect the old surface).
- A `CHANGELOG.md` entry under a `### Security` heading citing the advisory ID per `SECURITY.md`.

The spec major does **not** bump for a safety fix; the spec minor does. The suite minor bumps with scenarios that detect both the vulnerable shape and the fixed shape.

A safety fix is the only change that can break a released major. Everything else goes to the next major, except a v2 retirement that passes §3a.

**Corrections and safety-fix classifications on record** — every dated editorial, conformance-affecting and evidence correction, and every safety-fix classification — are kept in [`docs/COMPATIBILITY-CORRECTIONS-LOG.md`](./docs/COMPATIBILITY-CORRECTIONS-LOG.md).

## 3a. Retiring a v2 surface within the major (RFC 0197)

The rule is [`spec/v2/core/overview.md`](./spec/v2/core/overview.md) §0a; RFC 0197 §A states the six predicates.

- A v2 surface may be removed inside the major only when `scripts/check-v2-retirement.mjs` proves all six. That gate, `check-v2-surface-monotone.mjs` and the minor-aware `check-removal-dates.mjs` run in `npm run openwop:check`. A surface that fails any predicate waits for 3.0.
- A retirement narrows emission; readers keep accepting persisted shapes for the life of the major.
- `minClientVersion` MUST NOT be used to force a shape, because it refuses the whole client with `426`.
- A Class 3 correction that changes a v2 shape is recorded as a row in `spec/v2/corrections.json` and passes the same bundle and registry scan.

The precedents the rule writes down:

- **P1:** 2.8.2 removed two `workflowChainPacks` facets in a patch, and a committed bundle then failed `capabilities-root-closed`, because no gate scanned bundles.
- **P2:** 2.10 held `packs.testMode` and `observability.testSeams` to 3.0 because live bundles carry them.
- **P3:** the 2.32.0 `signing` correction (in the corrections log): a Class 3 shape change is allowed only when nothing conforming stops conforming.

## 4. Behavior-only changes

Some changes don't touch wire shapes but change observable behavior:

| Change | Allowed within a major? |
| --- | --- |
| New optional capability advertised, off by default | Yes — additive |
| Existing optional capability becomes default-on (changes observed behavior on hosts that didn't advertise it) | Only via the safety-fix process |
| Performance improvement that changes observed timing | Yes — timing is outside compatibility unless a spec document sets a bound |
| Stricter validation rejecting input that previously succeeded | Only via the safety-fix process |
| Looser validation accepting input that previously failed | Yes — additive (clients that sent invalid input were already broken) |
| New normative requirement on a previously undefined behavior | Yes — additive (the spec was previously silent) |

When in doubt, file an RFC and let the comment window surface compatibility concerns.

## 5. Moving to the next major

A change that cannot ship within a major goes to the next one. That includes any change that:

- Removes or renames an existing required field;
- Changes an existing field's type, semantics, or required/optional status;
- Changes an existing event type's shape;
- Removes or changes an existing endpoint's contract beyond additive fields; or
- Deprecates a capability so that clients pinned to the current major cannot continue to operate.

The RFC that opens a new major must include:

- A migration plan for current implementers, with every changed surface recorded in the migration register.
- A coexistence plan: how hosts serve both majors during the overlap and how clients select one ([`spec/v2/core/versioning.md`](./spec/v2/core/versioning.md) §1 and §5).
- The end-of-support rule for the old major (below).
- A new conformance suite major.

v2 followed this path. The v1→v2 migration guide is [`docs/migration/v1-to-v2.md`](./docs/migration/v1-to-v2.md).

### Old-major end of support

[`spec/v2/core/overview.md`](./spec/v2/core/overview.md) §"v1 end-of-support" states the rule normatively. v1 support ends at the later of:

- **(a)** every host in the [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) v2 table has published a non-vacuous v2 certification bundle, **plus 90 days**; and
- **(b)** **18 months from the v2 release**, if and only if the matrix listed a host operated by an independent organization when v2 was released.

**(c)** An `Accepted` RFC MAY set an earlier date once every counted host has a certified non-vacuous v2 bundle and reports no old-major traffic from third parties for at least the 7 days before the RFC. The date and its evidence are in `spec/v2/eos-override.json`. Nothing else may set the date.

RFC 0234 applied leg (c): **v1 reached end of support on 2026-10-04.** `evidence/v1-end-of-support.json` records the computed state. What the date means:

- **A host MAY drop v1** from `protocolVersions[]`. It is not required to do so on that day, and a host that keeps serving v1 remains conformant for its v2 surface. Dropping v1 retires the whole `/v1` path space at once (`versioning.md` §5).
- **The v1 tree is frozen as history.** `spec/v1/`, the flat `schemas/*.schema.json`, and `api/openapi.yaml` / `api/asyncapi.yaml` are not edited for v1's sake. (`api/openapi.yaml` and `api/asyncapi.yaml` stay in use as the source `scripts/derive-v2-api.py` reads.)
- **The last 1.x packages stay installable** for 12 months from the v2.0.0 publish (`overview.md` §"Old-major retention floors"; `spec/v2/retention-floors.json`), so a consumer pinned to 1.x can still rebuild.

## 6. Pinning recommendations

### For host implementers

- Advertise the highest spec minor your host passes. Don't hide additive capabilities to "stay compatible" — additive capabilities are the compatibility model.
- Pin the conformance suite version you pass in your README. Re-run the suite per release; if a suite minor fails your host, decide whether to fix or to keep pinning the older suite version.
- Watch `RFCS/` for normative additions before they ship.

### For client implementers

- Pin the SDK to the spec major you target (`@openwop/openwop@^2` for v2).
- Treat unknown fields and unknown event types as forward-compatible extensions: ignore them.
- Read `CHANGELOG.md` between SDK upgrades for safety-fix advisories.

### For application authors building on a host

- Pin to the host's advertised conformance suite version, not to the spec version directly. The host knows what it implements.
- Use the host's discovery document (`/.well-known/openwop`) to detect optional capabilities. Don't assume capabilities the host hasn't advertised.

## 7. Deprecation policy

The §2.2 prohibitions apply to deprecation too: an existing surface MAY be marked `deprecated` in spec text and SDK output, but MUST continue to behave as documented for the life of the major. A deprecation never removes a surface within the major; removal happens at the next major, or inside v2 only through §3a.

A deprecation requires:

- An RFC explaining the replacement.
- A spec annotation (`> Deprecated: …`) that points to the RFC.
- An SDK warning, where the SDK can detect use of the deprecated surface.
- A `CHANGELOG.md` entry under `### Deprecated`.

Deprecated surfaces continue to pass conformance. The `Deprecated:` annotation is informational, not normative.

**Deprecation register.** [`spec/v1/deprecations.json`](./spec/v1/deprecations.json) lists every surface an RFC or a spec annotation has deprecated, with its authority, replacement, removal trigger and removal version. Its schema is [`spec/v1/deprecations.schema.json`](./spec/v1/deprecations.schema.json).

- `scripts/check-deprecations.mjs` checks it in `npm run openwop:check`: a v1 deprecation removes no earlier than 2.0, never within 1.x.
- Entries carry `status: "deprecated"` only when an RFC or annotation exists. A surface only proposed for deprecation carries `status: "proposed"` with `deprecatedIn: null`.
- Removal dates are enforced at merge by `scripts/check-removal-dates.mjs`.

**v2 deprecations (RFC 0197).** A `v2-minor` row (`removalTrigger: "v2-minor"`, `removeIn: "2.N"`) schedules a removal inside the major. `check-removal-dates.mjs` enforces it against `spec/v2/release.json`, and it is admitted only when `check-v2-retirement.mjs` passes (§3a). Every other v2 deprecation removes at `3.0`.

## 8. What this document doesn't cover

- **Implementation-internal contracts.** A host's storage format, internal API, or RPC shape is the host's call. Compatibility within a host's implementation is the host's responsibility.
- **Non-normative spec text.** "Why this exists" sections, examples and notes may change freely. Compatibility applies only to normative requirements (`MUST`/`SHOULD`/`MAY`).
- **Conformance fixture wording.** Fixture names and human-readable descriptions are not part of the wire contract.

## 9. References

- `GOVERNANCE.md` — decision rules; this document tells maintainers what counts as additive vs. breaking.
- `RFCS/0001-rfc-process.md` — the RFC mechanism through which compatibility-affecting changes ship.
- `SECURITY.md` — the embargoed disclosure process referenced by the §3 safety-fix exception.
- `ROADMAP.md` — what's planned; uses this document's change classes.
- `MAINTAINERS.md` — who has authority to merge changes that affect this commitment.
- [`docs/COMPATIBILITY-CORRECTIONS-LOG.md`](./docs/COMPATIBILITY-CORRECTIONS-LOG.md) — the dated corrections on record under §3.
