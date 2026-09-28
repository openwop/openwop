# RFC 0220: an extension family graduates on evidence a script can read

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0220                                                            |
| **Title**         | an extension family graduates on evidence a script can read |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-27                                                      |
| **Updated**       | 2026-09-28: **`Active → Accepted`, provisional.** The RFC 0156 §B review is owed, and the §A.6 override stands as logged. **Evidence tier: tier-2 — steward-affiliated sibling host (MyndHyve) for §B and §C.1; tier-1 — steward-verified (the v2 reference host) for §C.2; corpus gate for §A, §D and §E.**

- §B and §C.1 are witnessed on `evidence/v2-host-bundles/myndhyve-2.43.0.json`: MyndHyve production `workflow-runtime-00800-nug`, `commit:fc3b007cf`, suite 2.43.0, both profiles certified, 262/0/0. There, `openwop.family.{chat,dataIntegration,entities,kanban,knowledge,webResearch}` pass the claims-check, and `openwop.family.restTransport` passes the behavioral conditional-GET and coding legs.
- §C.2 is witnessed on `evidence/v2-host-bundles/openwop-host-v2-reference.json` (#1727): the v2 reference host, `commit:bc8cc30`, suite 2.43.0, all three profiles certified, 406/0/0. There, `openwop.family.a2uiSurface` passes through the emit-surface seam.
- §A, §D and §E are enforced by `check-declaration.mjs` and `check-ext-status-coherence.mjs` in `openwop:check`. Each was sabotage-proved at filing.
- Live check at the flip: MyndHyve's `/.well-known/openwop` (revision `00803-roq`) still serves all seven `myndhyve.*` family records.

Earlier: 2026-09-28: **`dataIntegration` promoted `Stable`** (promotion window waived under the same override), on `evidence/v2-host-bundles/myndhyve-2.43.0.json`: MyndHyve production `workflow-runtime-00800-nug`, build `commit:fc3b007cf`, suite 2.43.0, both profiles certified, 262 pass / 0 fail / 0 blocked. MyndHyve now serves `data.transform` and `data.variable.compute` from its OpenWOP server (myndhyve #532); `dataIntegration` adoption `none` → `single-witness`. Earlier: 2026-09-28: **`Draft → Active`, comment window waived**. Filed `Draft` 2026-09-27 with the window to 2026-10-04, not waived; the steward directed the waiver on 2026-09-28. **STEWARD OVERRIDE of RFC 0147 §A.6.** §A.6 names certification as a class whose window bootstrap waiver language MUST NOT shorten, and §D changes which bundles count as maturity evidence. The override is recorded as its own row in `MAINTAINERS.md`, not folded under an earlier RFC's. The same direction waives the 7-day window on the first promotion PR (`ext/README.md` §Stable). Acceptance will be provisional, and the RFC 0156 §B review is owed. The evidence gate is not waived. Promoted `Stable` in this PR: `chat`, `entities`, `kanban`, `knowledge`, `restTransport`, `webResearch`, on `evidence/v2-host-bundles/myndhyve-2.42.8-ext-families.json` (MyndHyve production, tier 2, `openwop-core-standard` certified; #1690). Corrected here: `brand`, `canvas`, `coordination`, `dataIntegration`, `launchStudio` and `messaging` declared `adoption: single-witness`, but no host advertises them, so each now says `none`. Earlier: 2026-09-27: filed `Draft`. |
| **Affects**       | `spec/v2/declaration.json` + `declaration.schema.json` (`extensionName` on the 13 `anchor: ext` rows; `restTransport` witness `claims-check` → `witnessable-gated`, adoption `none` → `single-witness`; `a2uiSurface` witness `claims-check` → `seam-gated`) · `spec/v2/core/capabilities.md` §3.2 and §6 · `spec/v2/core/runs.md` §"Caching and encoding" (one key spelling) · `spec/v2/ext/README.md` (the tier half of `Stable`; the `Note` label) · the 13 ext family READMEs and the 3 note READMEs · new `evidence/host-tiers.json` · `scripts/check-ext-status-coherence.mjs`, `scripts/check-declaration.mjs` · conformance: new `lib/ext-claims.ts` (+ self-test), new scenarios `v2-ext-family-claims`, `v2-ext-rest-transport`, one new leg in `v2-a2ui-v09-surface` (suite 2.42.7) |
| **Compatibility** | `additive`, plus a Class 3 correction (§A). No wire shape, error code or status changes. §D makes a corpus gate stricter and fail closed. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`spec/v2/ext/README.md` defines `Stable` as a predicate over certified evidence, and `scripts/check-ext-status-coherence.mjs` enforces it. On 2026-09-27 all 17 pages on openwop.dev/spec/v2/ under "Extensions" read `Draft`, and none could ever become `Stable`:

- The predicate needs an `executed-pass` row under `openwop.family.<key>`. No scenario records one, for any family, core or ext. `gateFamily` records only `inapplicable` or `skipped`, under `openwop.profile.family.<key>`.
- The ext READMEs say to advertise `extensions.<org>.<key>` with a camelCase key such as `restTransport`. `extensionsKeyPattern` is kebab-case, so no host can emit that key. The two hosts that serve a family already use the kebab form: MyndHyve's `myndhyve.rest-transport` and `myndhyve.chat`.
- The README requires a host at evidence tier 2 or better. The checker accepts any certified bundle, including a loopback reference host.
- Four of the 17 pages are not families. Three are notes, outside the rule; `portability` is a core family, and #1671 retired its page. The notes still said `Draft`, which promised a graduation they can never have.

This RFC does four things:

- names the key (§A);
- defines the witness for each class of ext family (§B, §C);
- makes the tier half of the predicate machine-checkable (§D);
- gives notes their own label (§E).

## Motivation

Facts as of `origin/main` `54588558`, 2026-09-27:

- **No `openwop.family.*` row in any bundle.** None of the eight committed bundles in `evidence/v2-host-bundles/` has one. They carry 153 `requirement`, 63 `scenario`, 25 `it` and 20 `floor` rows (openwop-workflow-engine), and the same prefixes elsewhere.
- **The advertised keys.** app.openwop.dev serves `extensions` = {`openwop-app.host`, `openwop-app.host-surfaces`, `openwop-app.ai-providers`}. Its host-surface list names `host.canvas`, `host.chat`, `host.kanban`, `host.knowledge`, `host.launchStudio`, `host.messaging` and `host.webResearch`, but none as an extension record. MyndHyve's v2 document serves `myndhyve.chat` and `myndhyve.rest-transport` (`conditionalRunGet: true`, `contentEncodings: ["gzip","br"]`), derived by its v2 projection as `myndhyve.<kebab(key)>`.
- **The `a2uiSurface` witness exists but is invisible.** Its behavioral witness `v2-a2ui-v09-surface` is `executed-pass` in two certified bundles, the openwop-app side revision `rfc0199` and the loopback reference host, both tier 1. No row ties it to the family.
- **`restTransport` has behavior but no v2 witness.** RFC 0115's behavioral scenario `run-transport-economy` exists only at major 1, reading the v1 root key.

## Proposal

### §A. The advertised key

**§A.1** An ext family's declaration row carries `extensionName`, the kebab-case form of its `key`. A core row MUST NOT carry one (`check-declaration.mjs`). The family is advertised as `extensions["<org>.<extensionName>"]` (capabilities.md §3.2), never at the root.

**§A.2 (Class 3 correction.)** The ext READMEs, capabilities.md §3.2 and §6, and runs.md now use the kebab spelling. The camelCase key they printed matched no key a conforming host could emit, so no conforming host moves. Each README header now agrees with its declaration row by value (witness, technical, adoption) and names its advertised key. `check-declaration.mjs` checks both.

**§A.3** `a2uiSurface` is the exception. Its contract is admitted through `schemaVersions.kinds["ui.a2ui-surface"]`, and only its deprecated `deltaTransport` facet is an `extensions` record.

### §B. The `claims-check` witness for the 11 reservations

A reservation defines no portable operation, so the witness can only check the claim. `v2-ext-family-claims` records `openwop.family.<key>` for each of `brand`, `canvas`, `chat`, `coordination`, `dataIntegration`, `entities`, `kanban`, `knowledge`, `launchStudio`, `messaging` and `webResearch`:

- `executed-pass` when every claim is well formed:
  - the key matches `extensionsKeyPattern`;
  - the org is registered and not reserved;
  - the record is an object;
  - the family key is not also a root member.
- `executed-fail` when any claim is malformed.
- `inapplicable` when no registered org advertises the family.

A record under an unregistered org is not a claim on the family.

The gate is the claim itself, not `behaviorGate`. An ext family is outside every profile, so strict mode has nothing to demand of a host that does not serve it.

### §C. Behavioral witnesses for `restTransport` and `a2uiSurface`

**§C.1** `restTransport`'s witness becomes `witnessable-gated`. `spec/v2/ext/restTransport/README.md` defines the record's two facets and what the claim adds to runs.md §"Caching and encoding":

- `conditionalRunGet: true` turns that section's SHOULD `ETag` into a MUST on every `200`.
- Each listed coding MUST be produced when it is the only one requested.

`v2-ext-rest-transport` witnesses both under `openwop.family.restTransport`.

**§C.2** `a2uiSurface`'s witness becomes `seam-gated`. A new last leg of `v2-a2ui-v09-surface` records `openwop.family.a2uiSurface`, with an admitted positive and a refused control in one run.

### §D. The tier half of `Stable` is machine-checked

**§D.1** `evidence/host-tiers.json` lists hosts by discovery origin, with the tier `GOVERNANCE.md` §"Acceptance evidence tiers" gives each. An unlisted origin never qualifies. Adding a row is a governance act and cites the governance line.

**§D.2** `check-ext-status-coherence.mjs` counts an `openwop.family.<key>` pass toward `Stable` only from a bundle that meets both conditions:

- it certifies a profile;
- its `discovery.url` origin is listed at tier 2 or better.

It also enforces these rules:

- A `Stable` doc's declaration row says `technical: stable`, and a `Draft` doc's does not.
- A tier-1-only witness is reported as `NOT YET`, never as graduable.

### §E. Notes

A directory under `spec/v2/ext/` with no declared family carries `Status: Note.` and says it is not a declared family. A note is outside the maturity rule and never `Stable`. A declared family is never a note. The three notes are `grpc-transport`, `provider-idempotency` and `sandbox-runtime-notes`. A retired page with no family (today `portability`) carries a `Superseded by:` or `Retired by:` line.

## Compatibility

- **§A** is a Class 3 correction. The corrected text named a key that fails the discovery schema, so no host could have conformed to it. Both hosts that serve an ext family already emit the corrected spelling.
- **§B–§C** are `additive`: new scenarios, one new leg, and new rows. A host that advertises no ext family records `inapplicable` throughout.
- **§D–§E** are corpus-gate changes. They fail closed, and no page changes status because of them.
- **No wire change.** No schema property, `required` entry, error code or status moves. `declaration.schema.json` gains one optional property.

## Conformance

- **`src/lib/ext-claims.test.ts`** (self-test, server-free) has nine cases:
  - two well-formed claims;
  - absent, including a camelCase key and an unregistered org;
  - malformed: a reserved org, an array, a scalar or null record, a root copy of the key;
  - two orgs classified separately;
  - the corpus fact that every `claims-check` family has exactly one leg.

  Removing the reserved-org or root-copy check turns its case red. Both sabotages were run.
- **`v2-ext-family-claims`** (major 2): one leg per reservation, recorded under `openwop.family.<key>`.
- **`v2-ext-rest-transport`** (major 2): conditional GET (a strong `ETag`, `304` with no body, rotation across a real transition, and the parked `ETag` not matching the completed run) and the per-coding byte round trip, both under `openwop.family.restTransport`.
- **`v2-a2ui-v09-surface`**: the new family-witness leg.

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 kebab `extensionName` on every ext row, none on core | the declaration | the corpus | witnessable — corpus gate (`check-declaration.mjs`) |
| §A.2 README header agrees with its row and names its key | the README and the row | the corpus | witnessable — corpus gate (`check-declaration.mjs`) |
| §B a claim is well formed | the v2 discovery `extensions` object | the host | witnessable — gated on the claim (`openwop.family.<key>`) |
| §C.1 `conditionalRunGet: true` ⇒ an `ETag` on every run-snapshot `200`, and each listed coding is produced | response headers and bytes of `GET /runs/{runId}` | the suite, on the `conformance-approval` and `conformance-noop` fixtures | witnessable — gated on the claim |
| §C.2 the a2ui family leg | the emit-surface seam's answers | the suite, through the seam | witnessable — seam-gated |
| §D a `Stable` label rests on a tier-2+ certified row | bundles and `host-tiers.json` | the corpus | witnessable — corpus gate (`check-ext-status-coherence.mjs`) |
| §E a note is labeled `Note`, and a family never is | the READMEs | the corpus | witnessable — corpus gate (`check-ext-status-coherence.mjs`) |

## Alternatives considered

1. **Accept tier-1 evidence for ext families.** openwop-app is tier 1 and already serves 7 of the 11 reservations as host surfaces. Rejected: the README's tier-2 bar is the only thing separating `Stable` from "the steward says so". Lowering it for the families least able to show interoperation would invert the rule.
2. **A per-family `witnessIds` list in the declaration** (count an existing row such as `openwop.scenario.v2-a2ui-v09-surface`). This would graduate on bundles already committed, with no re-cut. Rejected: it names a second vocabulary for the same fact, and a scenario row folds every leg, so one unrelated leg could deny or grant the family.
3. **Write a portable contract for each reservation first** (for example `chat`'s operations). This is the honest route to interoperation. It is deferred rather than rejected: each is its own RFC, and a reservation's `Stable` is defined narrowly in `ext/README.md` so the label does not overclaim in the meantime.
4. **Retire the reservations nobody serves.** Not needed: MyndHyve, the tier-2 host, implements all 11 (Implementation notes).

## Unresolved questions

1. `chat` is the reservation with the clearest cross-host demand. Does it get a portable contract (an RFC of its own) before or after its `claims-check` graduation?
2. MyndHyve serves `canvas`, `kanban`, `brand` and `entities` from `canvas-runtime`, an origin that does no OpenWOP version negotiation. A reservation promises no operation, so advertising it from the v2 document promises nothing that origin must honour. Whether MyndHyve records that in the record body is its decision.

## Implementation notes (non-normative)

- MyndHyve's v2 projection (`services/workflow-runtime/src/routes/discoveryV2.ts`) already re-homes a non-core v1 root key to `extensions["myndhyve.<kebab(key)>"]`. Its v2 document drops `schemaVersions.kinds`, so `a2uiSurface`'s floor never reaches a v2 reader. It also serves no emit-surface seam, and its seams profile is deliberately off.
- openwop-app lists the families as `host-surfaces` entries, not `extensions` records.

## Acceptance criteria

- [x] Filed: the key, the witnesses, the tier table and the notes, with the self-test sabotage-proved.
- [x] `Active` (2026-09-28): window waived by steward override (see Updated); suite 2.42.7 and 2.42.8 are published.
- [ ] deferred: per-family promotion continues after acceptance, and each family's `Stable` label is its own evidence predicate (`ext/README.md`). Per family, `Draft → Stable` (a separate promotion PR with its own 7-day window; the first one's window is waived): **done for seven**: chat, entities, kanban, knowledge, restTransport and webResearch on #1690's bundle, and `dataIntegration` on `myndhyve-2.43.0.json`. `check-ext-status-coherence` reports the family `GRADUABLE` from a committed, certified MyndHyve bundle cut against the DEPLOYED revision.
  - Remaining: `messaging`, once MyndHyve's server-side path through its messaging gateway lands (an OIDC service-to-service lane; security-sensitive, a separate MyndHyve PR). `coordination`, `brand`, `canvas` and `launchStudio` are an honest no this pass: their executors are browser-only or `canvas-runtime` only, and no tier-2 host serves them (gap G4).
  - `a2uiSurface` waits on MyndHyve's seam (gap G1).
- [x] `Accepted` (2026-09-28, provisional): every Falsifiability row is witnessed. §B and §C.1 are witnessed at tier 2 on MyndHyve's certified bundle, and §C.2 at tier 1 on the certified reference-host bundle. §C.2 has no tier-2 witness: MyndHyve's seams profile is off (gap G1), and GOVERNANCE admits tier-1 evidence for an RFC flip. The tier-2 bar governs a family's `Stable` label, not this RFC.

## References

- `spec/v2/ext/README.md`; RFC 0174 (governance predicates); RFC 0177 (the extension tail); RFC 0169 §B–§C (the declaration file, witness classes); RFC 0144 (extension-class families); RFC 0115 (run transport economy); RFC 0209 (A2UI v0.9 surfaces).
- `GOVERNANCE.md` §"Acceptance evidence tiers".
