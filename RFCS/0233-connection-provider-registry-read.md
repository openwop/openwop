# RFC 0233: a host's connection providers and refused registrations are readable

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0233                                                            |
| **Title**         | a host's connection providers and refused registrations are readable |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-03                                                      |
| **Updated**       | 2026-10-03 — `Draft` → `Active`, comment window waived by STEWARD OVERRIDE of RFC 0147 §A.6 (MAINTAINERS.md), under the maintainer's directive of 2026-10-03 to take this RFC to `Accepted` without the window and to settle design questions by `/architect` review. The `/architect` rulings are in §Decisions; they move the resolve read's qualified form from the path into `?pack=`, and drop the discovery `fixtures` advert in favour of a self-describing registry. · 2026-10-03 — filed `Draft` at the maintainer's direction (2026-10-03: mint a normative observation path for the provider-identity MUSTs rather than demote them). The 7-day comment window opens with the pull request and closes 2026-10-10. |
| **Affects**       | two new optional v2 reads, `GET /connections/providers` and `GET /connections/providers/{providerId}` (`api/v2/openapi.yaml`, added in `scripts/derive-v2-api.py` as v2-only operations) and their schema · a new optional facet `connections.providerRead` (`spec/v2/facets/connections.schema.json`) · a conformance fixture pack `connection-pack-acme-widgets-rival` · `spec/v2/core/connection-packs.md` §Provider identity and §The qualified form · `v2-provider-conflict.test.ts` (a normative-surface path) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2): two optional reads behind one optional facet, and one optional fixture. A host that advertises neither is bound exactly as today. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Two connection-pack rules are MUSTs that no party can observe on a production host. A second registration of a bare provider id must be refused with `connection_provider_conflict`, and a qualified reference `<packName>#<id>` must resolve only to the named pack. Installing a pack is not a protocol operation, so the suite reaches both rules only through the RFC 0095 test seams, and `conformance.md` §Witness class says a MUST whose only witness is a seam must get a normative observation path or be demoted. This RFC mints the path: an optional read of the host's provider registry and of the registrations it refused, plus a resolve read for one reference, behind `connections.providerRead`. A host causes the conflict operator-side by installing a declared conformance fixture pair at deploy, and the suite reads the outcome.

## Motivation

**The corpus breaks its own witness rule.** `spec/v2/core/conformance.md` §Witness class: "A MUST whose only witness is `seam-gated` MUST either mint a normative observation path before the cut or be demoted to SHOULD." `connection-packs.md` §Provider identity states two MUSTs (refuse a second claimant; never choose by version) and §The qualified form states how a qualified reference resolves. `v2-provider-conflict` witnesses them only through `POST /conformance/seams/sample/connection-packs/{install,resolve}`. `packs.md` names the publication paths that install a pack (the canonical registry, a vendor registry's write API, a mirror ingest), and none is an operation on a host's protocol surface. The `connections` family is declared `witnessable-gated`, which is not true of these rules.

**It now blocks a production certification.** openwop-app declared `connections` at major 2 (its ADR 0809), and its seam-free production cut on suite 2.45.11 (build `451a665e8`) records three `blocked` rows from `v2-provider-conflict`. A bundle with a `blocked` row certifies nothing (RFC 0168 §E.1). The host implements the rule and passes the scenario in-process with seams on (its session's report, 2026-10-03). The same cut is the evidence RFC 0230 and RFC 0232 wait on.

**The alternatives were considered and rejected by the maintainer (2026-10-03).** Withdrawing the advert would under-state behaviour the host honours. Recording a seam-only leg `inapplicable` on a seam-free host would let any host advertise `packsSupported` unchecked. Demoting the MUSTs to SHOULD would weaken a rule that stops two packs from silently claiming one provider.

## Proposal

### §A. The facet

`connections` gains one optional member:

```json
"connections": { "packsSupported": true, "providerRead": true }
```

- `providerRead: true` means the host serves §B and §C.
- A host advertises it only with `packsSupported: true`.

### §B. The registry read

`GET /connections/providers` (`listConnectionProviders`), v2 only.

1. A host advertising `connections.providerRead` MUST serve it. A host that does not answers `404 not_found`.
2. **Host-global.** The provider registry is one per host (`connection-packs.md` §Provider identity). The read carries no tenant data and is the same for every caller. Scope: `manifest:read`.
3. The page lists every provider definition the host resolves against, built-ins included:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | the bare provider id |
| `source` | `builtin` \| `pack` | where the definition comes from |
| `packName` | string, when `source: pack` | the installed pack that defines it |

4. **Uniqueness is observable.** Each bare `id` MUST appear at most once.
5. The page also lists `refusals`, the registrations the host refused under §Provider identity:

| Field | Type | Meaning |
| --- | --- | --- |
| `packName` | string | the pack whose registration was refused |
| `providerId` | string | the bare id it claimed or referenced |
| `code` | `connection_provider_conflict` \| `connection_provider_unresolved` | why |
| `heldBy` | string, for a conflict | the `packName` holding the id, or `builtin` |

6. **Content-free.** A row carries ids, pack names and codes only: no endpoint URLs, no scope catalog, no credential material.
7. **Lifetime.** `refusals` reflects the installs the serving process attempted. A host MAY recompute it at every start and need not store it durably: the outcome is a function of the installed pack set.

### §C. The resolve read

`GET /connections/providers/{providerId}` (`resolveConnectionProvider`), v2 only, scope `manifest:read`. The optional query parameter `pack` names a pack: `?pack=<packName>` is the qualified form `<packName>#<providerId>`. The `#` never travels on the wire, because a front door that decodes `%23` would truncate the path.

1. Without `pack`, the bare id resolves only when exactly one definition exists. With `pack`, it resolves only to that pack's definition.
2. Resolved: `200` with one §B.3 row.
3. Not resolvable: `404` with `connection_provider_unresolved`. A qualified reference to a pack that does not define the id, or is not installed, is not resolvable.

### §D. The conformance fixture pair

`conformance/fixtures/connection-packs/` gains `connection-pack-acme-widgets-rival.json`: a well-formed pack named `core.openwop.connections.acme-widgets-rival` that also defines bare `acme-widgets`.

1. An operator MAY install `connection-pack-acme-widgets` (`core.openwop.connections.acme-widgets`) through the host's normal install path. A host that has it installed MUST also have attempted the rival after it, through the same path.
2. The registry is then self-describing: `acme-widgets` once, `source: pack`, held by the first pack, and a `refusals` row for `acme-widgets` with `connection_provider_conflict` and `heldBy` the first pack.
3. The pair is not advertised in discovery `fixtures`: those ids name workflow fixtures, which `v2-advertised-fixtures-exist` creates runs of (RFC 0168).
4. The provider is fictional and has no endpoints anyone calls.

### §E. Prose

`connection-packs.md` gains a short §Observation: the facet, the two reads, and §B.4–§B.7 and §C as rules. The kernel budget is the constraint; the schema carries the field tables.

### §F. Conformance

`v2-provider-conflict` gains a normative-surface path, run when the host advertises `connections.providerRead`. It runs alongside the seam path where both are offered, as `trigger-bridge-delivery` does since 2.45.8.

1. **fail-closed** (`openwop.requirement.0177.provider-conflict.fail-closed`): with the §D fixture installed, the registry lists `acme-widgets` exactly once, held by the first pack, and `refusals` carries a `connection_provider_conflict` row for `acme-widgets` held by it.
2. **qualified-form** (`openwop.requirement.0177.provider-conflict.qualified-form`): `acme-widgets?pack=<first>` resolves with `source: pack`; `acme-widgets?pack=<rival>` answers `404 connection_provider_unresolved`; bare `acme-widgets` resolves to the first pack.
3. **uniqueness** (new id `openwop.requirement.0233.provider-registry.unique`): the page is schema-valid and no bare id appears twice. It runs on any host with the facet.

Dispositions (§Decisions 2): no `packsSupported`, or no `providerRead` and no seam ⇒ `inapplicable`. `providerRead` without the §D fixture installed ⇒ legs 1–2 `inapplicable`, leg 3 still runs. A host advertising `providerRead` that does not serve it ⇒ the leg fails. A host advertising `packsSupported` SHOULD advertise `providerRead`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B.1, §B.4, §B.6 a host advertising the facet serves a schema-valid, content-free registry with each bare id once — `openwop.requirement.0233.provider-registry.unique` | `200`, the closed page schema, no duplicate `id` | the suite, unaided | witnessable — executed-pass required on a host bundle |
| §B.5 a refused registration appears with its code — `openwop.requirement.0177.provider-conflict.fail-closed` | the `refusals` row for `acme-widgets` held by the first fixture pack, and the id listed once | the operator, by installing the §D fixture pair | witnessable — executed-pass required on a host bundle |
| §C.1, §C.3 a qualified reference resolves only to the named pack; an unresolvable one is `404 connection_provider_unresolved` — `openwop.requirement.0177.provider-conflict.qualified-form` | the resolve answers for both fixture packs and for the bare id | the operator, by installing the §D fixture pair | witnessable — executed-pass required on a host bundle |
| §B.7 refusals reflect the serving process's installs | none from outside: a restart is not observable | nobody, from outside | unwitnessable — a process boundary is not on the wire (MAY, not a MUST) |

## Compatibility

`additive`.

- Two optional v2 reads behind one optional facet, one new fixture, one new requirement id.
- No existing field, endpoint, error code or rule changes. `connection_provider_conflict` and `connection_provider_unresolved` keep their meanings and statuses.
- The reads are v2 only. v1 resolves a collision by version precedence (`spec/v1/connection-packs.md`), so the v1 rule is different and gets no read here.

## Alternatives considered

1. **Demote the two MUSTs to SHOULD** (`conformance.md` §Witness class allows it). Fast. Rejected by the maintainer: it weakens the rule that stops two packs from claiming one provider.
2. **Record the seam-only legs `inapplicable` on a seam-free host.** Rejected by the maintainer: any host could advertise `packsSupported` and never be checked.
3. **A dry-run install endpoint** (`POST /connection-packs:validate` answers what an install would do). The suite could cause the conflict unaided, which is stronger. But it observes a validation function, not the install path, and the two can diverge; it is also a write-shaped surface. Deferred (§Decisions 3).
4. **An install endpoint on the protocol surface.** Makes installation a protocol operation, with the signing, supply-chain and authorization questions `packs.md` settles for registries. Out of scope.
5. **Advertise the fixture pair as a discovery `fixtures` id.** Rejected in review: `v2-advertised-fixtures-exist` would try to run it as a workflow.

## Decisions

An `/architect` review decided these on 2026-10-03, under the maintainer's directive to settle design questions that way. None remain open.

1. **Scope: `manifest:read`.** The registry is host-installed definitions with no tenant data, so it reads like the manifest reads. No new scope widens the authorization vocabulary. Not `packs:read`, which is the registry-side tarball read.
2. **Without the gate, a leg is `inapplicable`.** `conformance.md` defines `witnessable-gated` as "observed when the host advertises the gating capability"; here the gate is `providerRead`. This matches RFC 0232's attempt leg at major 2. To keep the gap visible rather than silent, a host advertising `packsSupported` SHOULD advertise `providerRead` (risk R4).
3. **No dry-run endpoint now** (gap G4 stays externally gated).
4. **`refusals` covers pack registrations only.** Connectors register through a different surface (RFC 0045).
5. **Wire shape.**
   - Two reads: the list witnesses uniqueness and refusals; the resolve witnesses resolution.
   - The qualified form is `?pack=`, never a `#` in the path.
   - `providerRead` is boolean, like `packsSupported`.
   - No paging: the set is bounded by the installed packs.
   - The fixture pair is self-describing in the registry, not a discovery `fixtures` id (§D.3).
   - The seam path stays as a second path.

## Implementation notes (non-normative)

- **openwop-app** (its session, 2026-10-03): both install paths already compute refusals (`loadConnectionPacks()` returns `{ installed[], errors[] }` with `{ pack, code, details: { provider, definedBy } }`), and the registry records each provider's owning pack. The work is keeping the outcome instead of dropping it, and serving it read-only. An in-memory, per-process record is enough (§B.7).
- **Sequencing.** Draft → Active with the schema, facet, reads and prose; the scenario path and its scratch-double proof in the same suite release; openwop-app serves the reads and installs the fixture pair; then its certified production cut.

## Acceptance criteria

- [x] `Active`: the questions are decided (§Decisions). The comment window was waived by STEWARD OVERRIDE of RFC 0147 §A.6 on 2026-10-03, and the RFC 0156 §B review is owed.
- [ ] The facet is in the v2 declaration; both reads are in `api/v2/openapi.yaml`; the page schema validates in `spec-corpus-validity`; the fixture is catalogued in `fixtures.md`; `connection-packs.md` §Observation is merged; `CHANGELOG.md` records it.
- [ ] `v2-provider-conflict`'s normative-surface path ships, each row failing on its sabotage: a registry listing one id twice, a missing refusal, a qualified reference resolving to the wrong pack, a rival reference that resolves, a row carrying an endpoint URL.
- [ ] `Accepted`: a host advertising `connections.providerRead`, with the §D fixture installed, records `openwop.requirement.0177.provider-conflict.fail-closed`, `openwop.requirement.0177.provider-conflict.qualified-form` and `openwop.requirement.0233.provider-registry.unique` `executed-pass` on a certified production bundle with no test seams served.

## References

- `spec/v2/core/conformance.md` §Witness class; `spec/v2/core/connection-packs.md` §Provider identity, §The qualified form; `spec/v2/core/packs.md` (publication paths); `spec/v1/host-sample-test-seams.md` §10.
- RFC 0095 (connection packs), RFC 0177 §D.1 (fail-closed provider identity), RFC 0003 (fixture advertisement), RFC 0168 §E.1 (a blocked row denies certification), RFC 0232 (the observation-path pattern this follows).
- `conformance/src/scenarios/v2-provider-conflict.test.ts`; openwop-app's 2.45.11 production cut (build `451a665e8`), three `blocked` rows.
- Registers: [`gaps`](./registers/0233-connection-provider-registry-read.gaps.md), [`risks`](./registers/0233-connection-provider-registry-read.risks.md).
