# openwop Compatibility Commitment

> **Status:** v1 — applies to the locked v1 contract and all subsequent v1.x releases.

This document defines what openwop guarantees about backward compatibility, when those guarantees can be relaxed, and how implementers should pin against the spec.

The TL;DR: **v1.x is additive-only, with one explicit exception for safety and security fixes.** Everything else that would break a v1 conformance pass goes to v2.

## 1. Versioning model

openwop uses three independent version axes:

| Axis | Range | Bump rule |
|---|---|---|
| **Spec corpus version** (e.g. `v1`, `v1.1`) | Major.Minor | Major = breaking; Minor = additive |
| **Conformance suite version** (`@openwop/openwop-conformance`) | Major.Minor.Patch | Major tracks spec major; Minor adds scenarios for the same spec major; Patch yanks/fixes scenarios |
| **SDK versions** (`@openwop/openwop`, `openwop-client`, Go SDK) | Major.Minor.Patch | Major tracks spec major; Minor adds methods or fixes types; Patch is bug fixes |

A host advertises:

- The spec major it implements (via `protocolVersion` in `/.well-known/openwop`).
- The conformance suite version it passes (per `ROADMAP.md`'s suite-expansion record).
- Optionally, the profile set it advertises (per `RFCS/`-bound profile definitions; see §3 of `spec/v1/profiles.md` once that lands).

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

- **Client-submitted shapes are closed.** Schemas validating client-submitted request bodies MUST be closed at the **outermost composition** — `additionalProperties: false` on a standalone object schema, or `unevaluatedProperties: false` at the composition site when the request shape is an `allOf` composition (JSON Schema 2020-12) — so client typos fail fast instead of being silently dropped. Closure MUST NOT be placed inside individual `allOf` branches (that composition is unsatisfiable).
- **Server-emitted shapes are open.** Schemas describing server-emitted documents (events, snapshots, discovery payloads) MUST NOT be closed, so a v1.x host can add optional fields per §2.1 without breaking schema-validating clients.

RFC 0094 applies this policy to the central server-emitted shape that violated it — `schemas/run-event.schema.json` is now open, with an `anyOf` vendor-event branch on `type` — and to the `createRun` request composition (closed via `unevaluatedProperties: false`). The full sweep of the remaining server-emitted schemas is a **named follow-up** (RFC 0094 §Unresolved questions), not silently included.

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

## 4. Behavior-only changes

Some changes don't touch wire shapes but change observable behavior:

| Change | Allowed in v1.x? |
|---|---|
| New optional capability advertised, off by default | Yes — additive |
| Existing optional capability becomes default-on (changes observed behavior on hosts that didn't advertise it) | Only via safety-fix process |
| Performance improvement that changes observed timing | Yes — outside the scope of compatibility (timing is not a normative wire surface unless `scale-profiles.md` documents it) |
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
- A deprecation timeline for v1 (typically 18–24 months from v2 release).
- An updated conformance suite major (`@openwop/openwop-conformance@2.0.0`).

v1.x and v2 ship as parallel tracks. v1.x continues to receive additive and safety-fix releases until the v1 deprecation date.

## 6. Pinning recommendations

### For host implementers

- Advertise the highest spec minor your host passes. Don't hide additive capabilities to "stay compatible" — additive capabilities ARE the compatibility model.
- Pin the conformance suite version you pass in your README. Re-run the suite per release; if a suite minor breaks your host, decide whether to fix or to keep pinning to the older suite version.
- Subscribe to `RFCS/` for normative additions before they ship.

### For client implementers

- Pin SDK to the spec major you target (`@openwop/openwop@^1.0` for v1.x).
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

## 8. What this document doesn't cover

- **Implementation-internal contracts.** A host's storage format, internal API, or RPC shape is the host's call. Compatibility within a host's implementation is the host's responsibility.
- **Non-normative spec text.** "Why this exists," examples, reference notes — these may change freely. Compatibility applies only to normative requirements (`MUST`/`SHOULD`/`MAY`).
- **Conformance fixture wording.** Fixture names and human-readable descriptions are not part of the wire contract.

## 9. References

- `GOVERNANCE.md` — decision rules; this document tells maintainers what counts as additive vs. breaking.
- `RFCS/0001-rfc-process.md` — the RFC mechanism through which compatibility-affecting changes ship.
- `SECURITY.md` — embargoed disclosure process referenced by the §3 safety-fix exception.
- `ROADMAP.md` — what's planned for v1.x and post-v1; references this document for the change-class definitions.
- `MAINTAINERS.md` — who has authority to merge changes that affect this commitment.
