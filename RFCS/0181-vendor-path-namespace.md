# RFC 0181: Vendor path namespace — `/host/<org>/…` for host-proprietary operations under major 2

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0181                                                            |
| **Title**         | Vendor path namespace: host-proprietary operations live at `/host/<org>/…`, keyed to the org registry, version-agnostic, outside the protocol contract |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-10                                                      |
| **Updated**       | 2026-09-10 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) under `GOVERNANCE.md` §"Sole-steward operation"; logged here and in `CHANGELOG.md` 2.0.12.) · 2026-09-11 (`Active → Accepted`). **Evidence tier: tier-2 — steward-affiliated sibling host** (`GOVERNANCE.md` §"Acceptance evidence tiers"): MyndHyve serves `/host/myndhyve/…` in production (revision `00346-cqw`, myndhyve#292, pinned to corpus 2.0.12) and advertises the mount as `extensions["myndhyve.vendor-namespace"] = { root, twin, roots[], rfc }` on both majors. Verified by the steward on the wire 2026-09-11: a `/host/myndhyve/…` request answers identically with no header, `2.0` and a malformed value, carries no `OpenWOP-Version` (§A.4); the `/v1/host/myndhyve/…` twin stamps `1.0` (§A.5). Tier-2 evidence is not independent evidence; tier-3 re-verification remains the `ROADMAP.md` gate. openwop-app's leg (#3728, ADR 0652) is in its gate and will be recorded when live. |
| **Affects**       | `spec/v2/core/versioning.md` §1.4, §5; `spec/v2/declaration.json` (`reservedOrgs`, two org registrations); `spec/v2/core/capabilities.md` §3.2 (cross-reference only) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1): v2 prose only; no field, MUST, error code or v1 surface changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A host serves operations the protocol does not name — `versioning.md` §5 recorded that they have no defined home once `/v1` retires, and left it undecided-not-permissive. This RFC decides it: a host-proprietary operation lives at **`/host/<org>/…`**, where `<org>` is the host's org registered in `spec/v2/declaration.json` `extensions` — the same registry that already keys vendor error codes, vendor event types, pack properties and `extensions.<org>.<name>` capability records. The path carries no major, is never a protocol operation, is never measured by the suite, and is advertised by the host's own `extensions.<org>` record. A `/v1/host/<org>/…` twin MAY be served through the overlap and retires atomically with `/v1`.

## Motivation

Two tier-1 hosts hit the gap on the day it was recorded. openwop-app serves 1,062 distinct `/v1/host/openwop-app/…` paths behind 328 client call sites; MyndHyve serves 11 proprietary roots. Under the atomic retirement in `versioning.md` §5 every one of those paths disappears with the `/v1` prefix and nothing in the corpus says where it goes, so neither host can split "migratable" from "no v2 home" in its own inventory. Worse, the manifest already has a `host` root (`/host/effect-seams`, `/host/events`), and one host's rewrite façade was measured answering `GET /host/openwop-app/orgs` under major 2 — an unadvertised home nobody had decided. The spec is the right place because the question is *what a path segment under a protocol root means*, which no host can decide alone, and because the corpus already has the registry the answer needs.

## Proposal

**§A.1 Namespace.** A host MAY serve operations the manifest does not name under `/host/<org>/…`, where `<org>` is an org registered in the `extensions` object of `spec/v2/declaration.json`. The path carries no major and is served regardless of `OpenWOP-Version`: nothing under it is a protocol operation, so §1.2 and §1.3 do not select a representation of it.

**§A.2 Registration is a precondition.** A host MUST NOT serve `/host/<org>/…` for an org that is not registered. Registration is one declaration.json row (`name`, `registered`); the org is the same one the host's vendor error codes and event types carry. This RFC registers `openwop-app` and `myndhyve`.

**§A.3 Reserved segments.** An org MUST NOT be named after the first path segment of any manifest operation under `/host/` (`effect-seams`, `events` at corpus 2.0.12). The declaration's `reservedOrgs` carries them; `check-declaration` refuses a registration that collides. The org grammar admitted both names before this RFC.

**§A.4 Not a protocol response.** A response under `/host/<org>/…` is produced by no protocol contract: the suite MUST NOT count it as reaching any operation, and `versioning.md` §1.4's constraints on a *non-protocol response on a manifest-named path* (no `OpenWOP-Version`, not `application/json`) do not apply to it — a vendor path is not a shared name. A host MAY stamp `OpenWOP-Version` there or not; the corpus does not read it.

**§A.5 Overlap twin.** A host MAY serve the same operations at `/v1/host/<org>/…` through the overlap. That twin is part of the `/v1` path space and retires atomically with it (§5); `/host/<org>/…` is the address that survives.

**§A.6 Advertisement.** A host serving `/host/<org>/…` SHOULD name the mount in its discovery document under `extensions.<org>.<name>` (`capabilities.md` §3.2 — the record's shape is the org's own), so that what declares the surface is the document, not the prefix. A registered org with no advertised mount is permitted; an advertised mount for an unregistered org is a §A.2 violation.

**§A.7 What this is not.** `/v2/host/<org>/…` (a major in the path) is rejected: RFC 0172 rejected a `/v2/` path space and a per-major vendor tree would be two trees to retire. A `/v1/host/*` exemption from retirement is rejected: retirement is atomic (§5), and an exempt proprietary tree keeps `1.x` in `protocolVersions[]` forever.

Positive example: `GET /host/openwop-app/orgs` on a host whose declaration row is `openwop-app` — served, JSON or otherwise, never measured. Negative examples: `GET /host/acme/…` with no `acme` row (§A.2 violation); a declaration row named `events` (§A.3, refused by `check-declaration`).

## Compatibility

`additive`. v1 is untouched: `/v1/host/<org>/…` keeps working through the overlap exactly as before. No v2 field, operation, error code or MUST changes; §5's open-gap paragraph becomes a decision and §1.4's non-protocol rule gains the scope it was written with.

## Conformance

No new scenario. §A.1/§A.4 are unwitnessable by construction — the suite never measures a vendor path — and this RFC says so rather than inventing a probe. §A.2/§A.3 are witnessed at the corpus, not the host: `check-declaration` validates every registration against `reservedOrgs` and the org grammar on every gate run.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.2 unregistered org served under `/host/` | a `/host/<org>/…` answer with no declaration row | a host, unaided | witnessable by inspection; **not probed** — the suite does not enumerate vendor paths |
| §A.3 reserved segment registered as an org | `check-declaration` refuses the declaration | a corpus PR | witnessable — corpus gate |
| §A.4 vendor response counted as a protocol response | `reachedUnderMajor2` / any scenario asserting on a vendor path | the suite (must not) | witnessable — suite review; none exist |
| §A.5 twin survives retirement | `/v1/host/<org>/…` answers after `protocolVersions[]` drops `1.x` | operator (retirement) | seam-gated (retirement is a host event) |

## Alternatives considered

1. **`/v2/host/<org>/…`.** Rejected — reintroduces the versioned path space RFC 0172 removed.
2. **Exempt `/v1/host/*` from retirement.** Rejected — contradicts atomic retirement; `1.x` would never leave the array.
3. **A dedicated top-level root (`/ext/<org>/…`).** Viable, but `/host` already exists as the manifest's host-scoped root and one host is already answering under it; adding a second root would move 1,062 paths for no gain.
4. **Do nothing.** Leaves two production hosts unable to inventory their December change; the measured unadvertised alias would persist by accident.

## Unresolved questions

1. ~~`GET /runs` (list) and `DELETE /runs/{runId}` are v1 *protocol* operations with no v2 twin~~ — **corrected 2026-09-11:** neither exists in v1 (`api/openapi.yaml` has only `createRun` and `getRun` on those paths; no `listRuns`/`deleteRun` in prose or the 1.x SDKs). They are host extensions at protocol-shaped paths, so §A.1 applies to them: they move under `/host/<org>/` or are accepted as gone. `GET /runs` (list) is additionally an unnamed method on a manifest-named path, which §1.4 (2.0.12) forbids serving as `application/json`. A portable run *list* is a real interop gap and is worth its own additive RFC (tenant-scoped, bound ids, cursor pagination, advertised family, one unaided scenario); a protocol *delete* contradicts the append-only log (`events.md`, `persistence.md`) and identity §5's never-reassigned ids, so it would be an erasure-tombstone RFC with retention and cross-tenant invariants, not a manifest row. Neither blocks end-of-support.
2. Whether the §A.6 advertisement should have a standard facet rather than an org-shaped record. Two data points now (2026-09-11): MyndHyve advertises `myndhyve.vendor-namespace` = `{ root, twin, roots[], rfc }`; openwop-app advertises `openwop-app.host` = `{ root, twin, rfc }`. `root`, `twin` and `rfc` are common to both; a standard facet, if one is ever wanted, is those three.

## Implementation notes (non-normative)

openwop-app's ADR 0646 façade already serves `/host/openwop-app/…` unversioned; making it canonical is the inverse of the December rewrite it has inventoried. MyndHyve's 11 roots map the same way. The reference host serves no vendor paths and needs no change.

## Acceptance criteria

- [x] `Draft → Active`: §5 decision + §1.4 scoping in `versioning.md`; `reservedOrgs` and two org rows in the declaration; CHANGELOG 2.0.12. (This PR.)
- [x] `Active → Accepted`: a production host serves `/host/<org>/…` for its registered org and advertises the mount under `extensions.<org>` — MyndHyve, 2026-09-11, tier-2 evidence verified on the wire (see `Updated`). openwop-app's leg (#3728) follows and will be added to the record; it is not required for this box.

## References

- `versioning.md` §1.2, §1.4, §5; `capabilities.md` §3.2; `errors.md` §vendor codes; `events.md` §Types; RFC 0172 §C (path space); RFC 0169 §B (declaration file).
- Steward bus 2026-09-10: `bca5` (the question), `8f27` §7c (the measured alias), `d4d0` (the ruling).
