# OpenWOP Registry & Extension Policy — index

> **Status: index (non-normative).** This is a one-stop pointer to the
> **authoritative** registry, namespace, name-reservation, and IPR policy, which
> is **[RFC 0043 — Registry and extension-policy](../../RFCS/0043-registry-and-extension-policy.md)**
> (`Draft`; ratifies to `Accepted` when the `GOVERNANCE.md` working-group
> tripwire fires). RFC 0043 is `additive` policy text — no wire-shape change.

## Why this exists

A non-steward implementer who wants to add a `vendor.acme.*` pack namespace,
register an `openwop-acme-feature` profile, or claim an `acme.*` OTel attribute
namespace needs **one place** that says: here is the policy, here is how to
submit, here are the rules I am bound by. These rules exist in `host-extensions.md`,
`registry-operations.md`, `node-packs.md`, and `auth.md` — RFC 0043 unifies them
and this index links to each.

## Policy map

| Topic                                                                                            | Authoritative source                                              | Operational reference                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extension namespaces** (`openwop.*` / `core.*` reserved; vendor/community/private/local rules) | [RFC 0043 §A](../../RFCS/0043-registry-and-extension-policy.md)   | [`host-extensions.md`](../../spec/v1/host-extensions.md)                                                                                                                                           |
| **Registry submission + trust tiers + signing**                                                  | [RFC 0043 §B](../../RFCS/0043-registry-and-extension-policy.md)   | [`registry-operations.md`](../../spec/v1/registry-operations.md), [`node-packs.md`](../../spec/v1/node-packs.md) §Signing                                                                          |
| **Deprecation / yank**                                                                           | [RFC 0043 §B.3](../../RFCS/0043-registry-and-extension-policy.md) | [`registry-operations.md`](../../spec/v1/registry-operations.md)                                                                                                                                   |
| **Signing-key rotation** (registry root: 90-day window + dual control)                           | [RFC 0043 §B.4](../../RFCS/0043-registry-and-extension-policy.md) | `registry/keys/registry-root.pub`                                                                                                                                                                  |
| **Profile / event / envelope-kind / capability name reservation**                                | [RFC 0043 §C](../../RFCS/0043-registry-and-extension-policy.md)   | [`profiles.md`](../../spec/v1/profiles.md), [`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json), [`capabilities.schema.json`](../../schemas/capabilities.schema.json) |
| **IPR posture** (DCO contribution model, license layout, disclosure)                             | [RFC 0043 §D](../../RFCS/0043-registry-and-extension-policy.md)   | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §"Sign your commits"                                                                                                                                    |

## Trust tiers (RFC 0043 §B.2)

| Tier                     | Namespace              | Submission gate                                                   |
| ------------------------ | ---------------------- | ----------------------------------------------------------------- |
| **Spec-authoritative**   | `core.openwop.*`       | Project maintainer; 2 maintainer approvals (1 in bootstrap-phase) |
| **Vendor-authoritative** | `vendor.<org>.*`       | DNS-verified ownership + standard signing; 1 maintainer approval  |
| **Community**            | `community.<author>.*` | Standard signing + supply-chain checks; 1 maintainer approval     |

The full per-tier verification + publication requirements are normative in
RFC 0043 §B.2; this table is a summary only.

## Open spec gaps

- Working-group ratification of RFC 0043 §B/§C (flips `Draft` → `Accepted`) is
  gated on the `GOVERNANCE.md` working-group tripwire (≥3 organizations + ≥2
  non-steward hosts) — a future-action gate, not a blocker for the Draft policy
  being auditable today.
- Trademark policy for "OpenWOP-compliant" claims is deferred to working-group
  formation (RFC 0038).
