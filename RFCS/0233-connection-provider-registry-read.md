# RFC 0233: a host's connection providers and refused registrations are readable

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0233                                                            |
| **Title**         | a host's connection providers and refused registrations are readable |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-03                                                      |
| **Updated**       | 2026-10-03 — filed `Draft` at the maintainer's direction (2026-10-03: mint a normative observation path for the provider-identity MUSTs rather than demote them). The 7-day comment window opens with the pull request and closes 2026-10-10. |
| **Affects**       | two new optional v2 reads, `GET /connections/providers` and `GET /connections/providers/{providerRef}` (`api/v2/openapi.yaml`, added in `scripts/derive-v2-api.py` as v2-only operations) and their schema · a new optional facet `connections.providerRead` (`spec/v2/facets`/declaration) · a conformance fixture pair (`conformance-provider-conflict`) · `spec/v2/core/connection-packs.md` §Provider identity and §The qualified form · `v2-provider-conflict.test.ts` (a normative-surface path) |
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
2. **Host-global.** The provider registry is one per host (`connection-packs.md` §Provider identity). The read carries no tenant data and is the same for every caller. Scope: unresolved question 1.
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

`GET /connections/providers/{providerRef}` (`resolveConnectionProvider`), v2 only. `providerRef` is a bare id or a qualified `<packName>#<id>`, carried as one path segment (percent-encoded `#`).

1. A bare id resolves only when exactly one definition exists; a qualified reference resolves only to the named pack's definition.
2. Resolved: `200` with one §B.3 row.
3. Not resolvable: `404` with `connection_provider_unresolved`. A qualified reference to a pack that does not define the id, or is not installed, is not resolvable.

### §D. The conformance fixture pair

`conformance/fixtures/connection-packs/` gains `connection-pack-acme-widgets-rival.json`: a well-formed pack with a different `name` that also defines bare `acme-widgets`.

1. A host that advertises the fixture id `conformance-provider-conflict` in its discovery `fixtures` (RFC 0003) has installed `connection-pack-acme-widgets` and then attempted `connection-pack-acme-widgets-rival`, in that order, through its normal install path.
2. That host MUST therefore show `acme-widgets` once, `source: pack`, held by the first pack, and a refusal for the rival with `connection_provider_conflict` and `heldBy` the first pack.
3. A host installs the pair only when its operator chooses to; the provider is fictional and has no endpoints anyone calls.

### §E. Prose

`connection-packs.md` gains a short §Observation: the facet, the two reads, and §B.4–§B.7 and §C as rules. The kernel budget is the constraint; the schema carries the field tables.

### §F. Conformance

`v2-provider-conflict` gains a normative-surface path, run when the host advertises `connections.providerRead` and the `conformance-provider-conflict` fixture. It runs alongside the seam path where both are offered, as `trigger-bridge-delivery` does since 2.45.8.

1. **fail-closed** (`openwop.requirement.0177.provider-conflict.fail-closed`): the registry lists `acme-widgets` exactly once, held by the first fixture pack, and `refusals` carries the rival with `connection_provider_conflict`.
2. **qualified-form** (`openwop.requirement.0177.provider-conflict.qualified-form`): `<first>#acme-widgets` resolves with `source: pack`; `<rival>#acme-widgets` answers `404 connection_provider_unresolved`; bare `acme-widgets` resolves to the first pack.
3. **uniqueness** (new id `openwop.requirement.0233.provider-registry.unique`): no bare id appears twice in the registry. It runs on any host with the facet, fixture or not.

Dispositions: no `packsSupported` ⇒ `inapplicable`. `packsSupported` with neither the seams nor `providerRead` plus the fixture: unresolved question 2. A host advertising `providerRead` that does not serve it ⇒ the leg fails.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B.1 a host advertising the facet serves the read | `200` and a schema-valid page | the suite, unaided | witnessable — gated |
| §B.4 a bare id appears at most once | the registry page | the suite, unaided | witnessable — gated |
| §B.5 a refused registration appears with its code | the `refusals` row for the rival | the operator, by installing the §D fixture pair | witnessable — gated |
| §B.6 a row is content-free | every row against the schema's closed shape | the suite, unaided | witnessable — gated |
| §C.1 a qualified reference resolves only to the named pack | the resolve answers for both fixture packs | the operator, by installing the §D fixture pair | witnessable — gated |
| §C.3 an unresolvable reference is `404 connection_provider_unresolved` | the resolve answer for the rival | the operator, by installing the §D fixture pair | witnessable — gated |
| §B.7 refusals reflect the serving process's installs | none from outside: a restart is not observable | nobody, from outside | unwitnessable — a process boundary is not on the wire (MAY, not a MUST) |

## Compatibility

`additive`.

- Two optional v2 reads behind one optional facet, one new fixture, one new requirement id.
- No existing field, endpoint, error code or rule changes. `connection_provider_conflict` and `connection_provider_unresolved` keep their meanings and statuses.
- The reads are v2 only. v1 resolves a collision by version precedence (`spec/v1/connection-packs.md`), so the v1 rule is different and gets no read here.

## Alternatives considered

1. **Demote the two MUSTs to SHOULD** (`conformance.md` §Witness class allows it). Fast. Rejected by the maintainer: it weakens the rule that stops two packs from claiming one provider.
2. **Record the seam-only legs `inapplicable` on a seam-free host.** Rejected by the maintainer: any host could advertise `packsSupported` and never be checked.
3. **A dry-run install endpoint** (`POST /connection-packs:validate` answers what an install would do). The suite could cause the conflict unaided, which is stronger. But it observes a validation function, not the install path, and the two can diverge; it is also a write-shaped surface. Kept as unresolved question 3.
4. **An install endpoint on the protocol surface.** Makes installation a protocol operation, with the signing, supply-chain and authorization questions `packs.md` settles for registries. Out of scope.

## Unresolved questions

1. **Which scope reads the registry?** It is host-global and carries no tenant data. Options: no new scope (any authenticated caller), `packs:read`, or a new `connections:read`. openwop-app asked for this to be stated (its session, 2026-10-03).
2. **A host with `packsSupported` that serves neither the seams nor `providerRead` plus the fixture.** Today its rows are `blocked`. After this RFC there is a normative path the host chose not to offer. Options: (a) keep `blocked` (the host advertises behaviour it offers no way to check); (b) `inapplicable`, as RFC 0232's attempt leg records without `triggerBridge.deadLetter`. The author leans (a) for `packsSupported`, since the facet is now the cheap, honest way to be checked.
3. **Should a dry-run validate endpoint (Alternative 3) be added later** so the suite can cause a conflict without the operator?
4. **Should `refusals` include `connection_provider_unresolved`** for a connector (not a pack) that references an undefined provider? Connectors are registered elsewhere; this RFC lists pack registrations only unless decided otherwise.

## Implementation notes (non-normative)

- **openwop-app** (its session, 2026-10-03): both install paths already compute refusals (`loadConnectionPacks()` returns `{ installed[], errors[] }` with `{ pack, code, details: { provider, definedBy } }`), and the registry records each provider's owning pack. The work is keeping the outcome instead of dropping it, and serving it read-only. An in-memory, per-process record is enough (§B.7).
- **Sequencing.** Draft → Active with the schema, facet, reads and prose; the scenario path and its scratch-double proof in the same suite release; openwop-app serves the reads and installs the fixture pair; then its certified production cut.

## Acceptance criteria

- [ ] `Active`: the comment window closes (2026-10-10) with no unresolved objection, and unresolved questions 1 and 2 are decided.
- [ ] The facet is in the v2 declaration; both reads are in `api/v2/openapi.yaml`; the page schema validates in `spec-corpus-validity`; the fixture is catalogued in `fixtures.md`; `connection-packs.md` §Observation is merged; `CHANGELOG.md` records it.
- [ ] `v2-provider-conflict`'s normative-surface path ships, each row failing on its sabotage: a registry listing one id twice, a missing refusal, a qualified reference resolving to the wrong pack, a rival reference that resolves, a row carrying an endpoint URL.
- [ ] `Accepted`: a host advertising `connections.providerRead` and the fixture records the §F rows `executed-pass` on a certified production bundle with no test seams served.

## References

- `spec/v2/core/conformance.md` §Witness class; `spec/v2/core/connection-packs.md` §Provider identity, §The qualified form; `spec/v2/core/packs.md` (publication paths); `spec/v1/host-sample-test-seams.md` §10.
- RFC 0095 (connection packs), RFC 0177 §D.1 (fail-closed provider identity), RFC 0003 (fixture advertisement), RFC 0168 §E.1 (a blocked row denies certification), RFC 0232 (the observation-path pattern this follows).
- `conformance/src/scenarios/v2-provider-conflict.test.ts`; openwop-app's 2.45.11 production cut (build `451a665e8`), three `blocked` rows.
- Registers: [`gaps`](./registers/0233-connection-provider-registry-read.gaps.md), [`risks`](./registers/0233-connection-provider-registry-read.risks.md).
