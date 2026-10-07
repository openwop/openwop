# OpenWOP Registry & Extension Policy — index

> **Status: index (non-normative).** One place to find the registry, namespace, name-reservation and IPR policy. The policy is **[RFC 0043 — Registry and extension policy](../../RFCS/0043-registry-and-extension-policy.md)** (`Accepted`). The v2 wire rules it sits on are [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) and the other core docs linked below; v2 registry operations are [RFC 0222](../../RFCS/0222-v2-registry-operations.md).

## Why this exists

An implementer who wants a `vendor.acme.*` pack namespace, an `acme.*` event or capability namespace, or a profile name needs one page that says where the policy is, how to submit, and which rules bind them.

## Policy map

| Topic | Policy | Normative v2 rules | How to do it |
| --- | --- | --- | --- |
| **Pack namespaces and trust tiers** (`core.openwop.*`, `vendor.<org>.*`, `community.<author>.*`, `private.*`) | [RFC 0043 §A, §B.2](../../RFCS/0043-registry-and-extension-policy.md) | [`packs.md`](../../spec/v2/core/packs.md) §Signing (`permittedNamespaces`) | [`VENDOR-ONBOARDING.md`](../runbooks/VENDOR-ONBOARDING.md) |
| **Registry submission and signing** | [RFC 0043 §B.1](../../RFCS/0043-registry-and-extension-policy.md), [RFC 0222 §D](../../RFCS/0222-v2-registry-operations.md) | [`packs.md`](../../spec/v2/core/packs.md) §Signing, §"Version manifests" | [`PACK-AUTHOR-QUICKSTART.md`](../PACK-AUTHOR-QUICKSTART.md) |
| **Deprecation and yank** | [RFC 0222 §B](../../RFCS/0222-v2-registry-operations.md) | [`packs.md`](../../spec/v2/core/packs.md) §"Version manifests" | [`PACK-LIFECYCLE.md`](../runbooks/PACK-LIFECYCLE.md) |
| **Signing-key rotation** (including the registry root key's dual control) | [RFC 0043 §B.4](../../RFCS/0043-registry-and-extension-policy.md), [RFC 0222 §C](../../RFCS/0222-v2-registry-operations.md) | [`packs.md`](../../spec/v2/core/packs.md) §Signing | [`KEY-ROTATION.md`](../runbooks/KEY-ROTATION.md) |
| **Vendor orgs for capabilities, events, error codes and envelope kinds** | [RFC 0043 §C](../../RFCS/0043-registry-and-extension-policy.md) | [`capabilities.md`](../../spec/v2/core/capabilities.md) §3.2, [`events.md`](../../spec/v2/core/events.md), [`versioning.md`](../../spec/v2/core/versioning.md) §"Host-proprietary paths"; the org registry and `reservedOrgs` are in [`spec/v2/declaration.json`](../../spec/v2/declaration.json) | Open a PR adding the org to `spec/v2/declaration.json` |
| **IPR** (DCO contribution model, license layout, disclosure) | [RFC 0043 §D](../../RFCS/0043-registry-and-extension-policy.md) | — | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §"Sign your commits (DCO)" |

RFC 0043 §B.3 and §B.4 were written against the earlier major's registry flows (tarball deletion on yank, a 72-hour unpublish window, write endpoints). For the v2 tree the rules in `packs.md`, restated by RFC 0222, apply: a yanked version stays served, published bytes are immutable, and every lifecycle change is a pull request to [openwop/openwop-registry](https://github.com/openwop/openwop-registry).

## Trust tiers (summary of RFC 0043 §B.2)

| Tier | Namespace | Submission gate |
| --- | --- | --- |
| **Spec-authoritative** | `core.openwop.*` | Project maintainer |
| **Vendor-authoritative** | `vendor.<org>.*` | Verified org ownership and a registered signing key |
| **Community** | `community.<author>.*` | Standard signing and supply-chain checks |

The full per-tier requirements are in RFC 0043 §B.2.

## Open items

- Working-group review of RFC 0043 §B/§C is a future-action gate under [RFC 0038](../../RFCS/0038-working-group-charter.md); it does not block the policy in force.
- A trademark policy for conformance claims is deferred to working-group formation.
