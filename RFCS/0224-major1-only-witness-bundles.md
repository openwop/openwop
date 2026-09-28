# RFC 0224: a requirement only a major-1 scenario can witness is accepted on a major-1 witness bundle

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0224                                                            |
| **Title**         | a requirement only a major-1 scenario can witness is accepted on a major-1 witness bundle |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-28: filed `Draft`. The 7-day comment window runs in full, to 2026-10-05, and is **not waived**. This RFC is high-risk under RFC 0147 §A.6: it changes what counts as acceptance evidence for `certification`-adjacent predicates (RFC 0174 §B.1 rule 4), which is exactly the class whose window bootstrap waiver language MUST NOT shorten. It also amends the Accepted predicate, which GOVERNANCE §"Amendments" treats as the decision rule: two maintainer approvals are required, one maintainer exists, and the approval-count question is recorded as Unresolved question 6 for the `Active` flip rather than decided here. No mechanism lands with this filing. The predicate change lands at `Active`, never at `Draft`, because it loosens a gate. |
| **Affects**       | RFC 0174 §B.1 rule 4 (a third branch, at `Active`) · `scripts/check-accepted-predicate.mjs` (at `Active`) · `GOVERNANCE.md` §"Acceptance evidence tiers" (one bullet, at `Active`) · `evidence/rfc-witnesses/README.md` (a second section, at `Active`) · new coherence scenario `v2-major1-witness-bundle.test.ts` (planned, at `Active`). No spec document, schema, wire shape, error code or host obligation changes. |
| **Compatibility** | `additive` (corpus-governance only). No host, client or bundle changes. The acceptance gate admits one new, closed class of evidence for one closed class of requirement id and fails closed on everything else. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`check-accepted-predicate.mjs` credits a host-tier requirement id only from an `executed-pass` row in a bundle under `evidence/v2-host-bundles/` that is certified on every claimed profile, or from the corpus ledger. A requirement id minted **only** by scenario files that run at major 1 can never appear in a major-2 bundle. Certifying a whole v1 host at major 1 is effectively unreachable. So an RFC whose witness is major-1-only can never reach `Accepted`, and after v1 end-of-support (not before 2026-12-04) no such bundle will be cut at all. This RFC admits exactly one new kind of evidence for exactly those ids: a signed, attributable **major-1 witness bundle** under `evidence/rfc-witnesses/` in which the witnessing scenario file is clean, whatever the rest of the bundle says. The bundle is evidence for the named ids only, never a certification or a profile claim, and the rule sunsets at v1 end-of-support.

## Motivation

Facts measured on 2026-09-28 against corpus tip `9fe6b0b0` (suite 2.43.0, unreleased; 2.42.9 published).

### 1. Rule 4 has no route for a major-1-only id

RFC 0174 §B.1 rule 4 requires every requirement id an RFC's falsifiability table names to be accounted for by a bundle or the corpus ledger. The implementation (`scripts/check-accepted-predicate.mjs`, lines 53–91) reads only `evidence/v2-host-bundles/`. Since 2.4.2 it skips any bundle whose `claimedProfiles[]` are not all `certified: true` (hole 4 in the 2.4.2 hardening: an uncertified bundle supplied witnesses exactly like a certified one). Every bundle in that directory is cut at `--target-major 2`.

`conformance/scenario-majors.json` assigns each scenario file its majors: 439 files are `[1]`, 117 are `[2]`, 12 are `[1, 2]`. A file at `[1]` never runs in a major-2 cut, so no id it mints can reach that directory.

### 2. Which ids this affects

Scanning `conformance/requirements.json` (explicit ids, and legs `<id>.<leg>` by rule 4's own leg rule) against `scenario-majors.json` and every RFC's falsifiability table:

| Measure | Count |
| --- | --- |
| `openwop.requirement.*` ids minted by any scenario file | 332 |
| minted only by `[1]` files | 5 |
| of those, named in some RFC's falsifiability table | **1** |

The one id is **`openwop.requirement.0218.checkpoint-signature-over-root`**, minted only by `audit-checkpoint-signature.test.ts` (`[1]`), named by RFC 0218 (`Active`) with the verdict "witnessable — gated on the profile". RFC 0218's only open acceptance box is that row on a host bundle.

The other four are not declared by any table: `0200.oauth2cc-wrong-aud-401` (`auth-oauth2-client-credentials.test.ts`) and three `version-negotiation.*` legs in `era-key-stamped-v1.test.ts`. Two declared ids are minted by a `[1]` file **and** a `[2]` file (`0207.mcp-traceparent-carried`, `0207.a2a-traceparent-carried`). They already have a v2 route and are witnessed on a certified bundle today. They are not affected. RFC 0218's sibling id `0218.checkpoint-preimage-vectors` is minted by a `[1, 2]` server-free file and is not affected either. The one in-flight PR that adds a 0218 id (openwop#1703, `0218.anomaly-shape`) mints it in a both-majors file.

**Future RFCs.** Any RFC that names a requirement on a v1 family with no v2 home will hit the same wall. The audit-log integrity family is the live case. `spec/v2/profiles.json` lists no audit-log profile, no v2 core document states it, and its only v2 trace is the derived `GET /audit/verify` path in `api/v2/openapi.yaml`. Neither openwop-app nor MyndHyve advertises the profile. It is claimed by the SQLite and Postgres v1 reference hosts in `openwop-examples`.

### 3. The status quo already produced a silent carve-out

RFC 0200 §C (`Accepted`) hit this wall and routed around it. Its falsifiability row for the OAuth2-CC wrong-audience leg says the leg is witnessable "at major 1 only" and "**non-gating** … no v2 cut reaches a major-1 file, so this row carries no requirement id for rule 4". The row names the leg as `0200.oauth2cc-wrong-aud-401`, deliberately not as a full `openwop.requirement.` id, so the gate never looks it up. That is honest prose. It is also a v1 MUST that the acceptance gate has agreed not to check. Doing nothing makes that the standard move.

### 4. Certifying the v1 host is not a route

The Postgres reference host is the host RFC 0218's box names. On 2026-09-28 the steward ran it against the **published** suite 2.42.8 at `--target-major 1`, strict mode. The dry run is not committed. It reported 1098 pass / 305 fail / 234 blocked. About 220 blocked rows come from seams the host does not mount and harness pieces the run did not have, and 8 failures are host defects. In the same run, both `openwop.requirement.0218.checkpoint-signature-over-root` and `openwop.requirement.0218.checkpoint-preimage-vectors` were `executed-pass`.

RFC 0168 §E.1 denies certification on a single `blocked` row. Clearing 234 blocked rows on a host whose major is scheduled to end is a large piece of work bought only to satisfy a gate. It would also measure much more than RFC 0218 claims.

### 5. The clock

`evidence/v1-end-of-support.json`: `endOfSupportNotBefore: 2026-12-04` (leg (a); leg (b) does not apply). After that date no v1 host bundle will be cut, and `check-removal-dates.mjs` starts failing v1-tree sources. An id that has not reached acceptance by then never will.

### 6. Precedent below the program line

RFC 0111 is a pre-program RFC, so the predicate does not bind it. It went `Accepted` on 2026-09-26 on `evidence/rfc-witnesses/0111-myndhyve-major1-2.42.1.json`: an **uncertified** major-1 bundle (1415 / 168 / 190 / 303 / 27), signed under a key in the host's live discovery, verified with the published suite, and citing two `executed-pass` rows with no `partial-witness`. That was a steward decision recorded in RFC 0111's `Updated`. This RFC turns that judgement into a closed rule a script can check, for RFCs the predicate does bind, and makes it stricter than RFC 0111's precedent in two places: §C.2 and §B.3.

## Proposal

The normative text below amends RFC 0174 §B.1 rule 4 by adding a **third branch**. It is written here and lands in RFC 0174, GOVERNANCE and the gate at `Active`. RFC 0174 owns the predicate, so this RFC does not state it in parallel (see `CONTRIBUTING.md` §"An RFC MUST NOT state a rule a core doc owns").

### §A. Which ids are eligible

1. **Major-1-only.** A requirement id X is *major-1-only* when, in the `requirements.json` and `scenario-majors.json` **published in the suite version the witness bundle names** (§B.3):
   - (a) at least one scenario file mints X or a leg `X.<leg>`, where a leg is any id under X that is not itself a declared requirement (rule 4's existing leg rule); and
   - (b) every such file's `scenario-majors.json` entry is exactly `[1]`.

   An id minted by any `[2]` or `[1, 2]` file is not eligible, even if no major-2 bundle carries it yet. The v2 route exists, and it is the one to use. An id minted only by a coherence file (`src/coherence/`) is a corpus-ledger id and not eligible.
2. **Host-tier and marked.** The RFC's falsifiability row naming X is host-tier: it carries no `(corpus)` label. Its verdict cell carries the literal marker **`(major-1 witness)`**. The marker is a reciprocal claim, in the RFC 0191 sense: the author states in a reviewable place that this requirement's only witness is a major-1 scenario. The gate does not infer it. The gate applies §B–§E only to marked rows. It **fails** a marked row whose id is not major-1-only under §A.1, so the marker cannot outlive the fact it asserts.
3. **Nothing else changes.** Unmarked rows, `(corpus)` rows, the second branch (a declared non-executable verdict accounted for by a reasoned non-pass row), companion pairing (RFC 0216 §C), and the certified-only reading of `evidence/v2-host-bundles/` are unchanged. In particular, an uncertified bundle in `evidence/v2-host-bundles/` still supplies no witness for any id, marked or not.

### §B. What a major-1 witness bundle is

A file under `evidence/rfc-witnesses/` is a *major-1 witness bundle* for this rule only when **all** of the following hold. The gate checks each one.

1. **Bundle v3.** `bundleVersion: "3"`, and the file validates against `schemas/v2/certification-bundle.schema.json` (RFC 0168 §E.1). A v3 bundle is v3 regardless of the major it measured (RFC 0168 §E.2 `.v1-root`). RFC 0168 §E.3's "v1 substantiates nothing after 2026-11-10" concerns bundle *formats* 1 and 2, not target major 1.
2. **Major 1.** `suite.targetMajor` is `1`.
3. **A published suite that contains the witness.** `suite.version` is a version whose release tag exists on `origin/main` (`v<version>` or `openwop-conformance/v<version>`), and the tree at that tag mints X in a `[1]` file (§A.1 is evaluated there). A pre-release or unreleased version never qualifies. RFC 0111's precedent verified with the published suite. This rule makes that a condition, because the published tarball is what a third party can re-run.
4. **Rows unedited.** `witnessSha256` recomputes over the bundle's rows as the published suite's verifier computes it (RFC 0148 §C).
5. **Discovery captured and bound.** `discovery.document` is present, and `discovery.sha256` is its digest as the verifier computes it. Both are inside the signature preimage (RFC 0168 §E.2).
6. **Attributable.** `signature.keyId` names an entry of `discovery.document.signingKeys[]` with `use: "certification-bundle"`, and the signature verifies under that entry's `publicKey` over the §E.2 preimage. A key published only elsewhere, or only in a different document, does not count. The discovery is the host's **v1** document, so this is the `openwop.requirement.0168.bundle-signature-attributable.v1-root` case.
7. **Names its host.** `discovery.url` is present and equals the URL the citing RFC's `Updated` line names (§D.1). That the bundle measured the host at that URL is a cut-time obligation: the cut asserts `discovery.url` equals the started host. The gate cannot observe it (see §Falsifiability).

### §C. What the bundle must show

1. **A clean witness.** The bundle carries at least one row for X or a leg of X with `result: "executed-pass"`, `assertions ≥ 1`, and no `detail` beginning `partial-witness:`.
2. **The witnessing file is clean.** Let F be the set of scenario files that mint X (§A.1). Every row in the bundle whose `scenario` is in F is `executed-pass` and non-partial: the per-`it` rows and the `openwop.scenario.<stem>` row alike. One `executed-fail`, `blocked`, `inapplicable` or `skipped` row in F disqualifies the bundle for X.
   - `inapplicable` is refused because it means the gating claim was not made or the leg did not apply. Either way the file did not observe the behaviour it exists for.
   - `skipped` is refused because it records an operator opt-out.
   - This is stricter than RFC 0111's precedent, which read the two cited rows alone.
3. **The rest of the bundle may fail.** Rows outside F may be `executed-fail`, `blocked`, `inapplicable` or `skipped`, and `claimedProfiles[].certified` may be `false`. That is the whole point: the bundle is not asked to certify the host.

### §D. What it is not, and how it is cited

1. **Citation.** The `Active → Accepted` `Updated` line of an RFC that relies on this branch MUST:
   - declare `Evidence tier: tier-N — …` with N = 1, 2 or 3 (a reference host in `openwop-examples` is tier-1), never `corpus gate`;
   - cite the bundle path under `evidence/rfc-witnesses/` and its file sha256 in full (64 hex digits);
   - name `host.build`, `suite.version`, `discovery.url`, and the bundle's totals; and
   - state that the bundle is not a certification.

   The gate checks that the cited path exists and that its sha256 matches the file byte-for-byte, so a re-cut replacing the file un-witnesses the RFC until the citation is updated.
2. **Evidence for the named ids only.** A major-1 witness bundle MUST NOT be described as a certification, a profile claim or a conformance claim. It MUST NOT be cited in any `INTEROP-MATRIX.md` certification or claims column, and MUST NOT be placed in `evidence/v2-host-bundles/`. It does not feed `generate-v1-eos-clock.mjs`, which reads only `evidence/v2-host-bundles/`, so it moves no anchor. The gate credits it for marked eligible ids and nothing else: every other `executed-pass` row in it counts toward nothing, and the gate reports them as discarded, as it does for a companion.
3. **Deployed, not merged.** GOVERNANCE §"Deployed, not merged" applies unchanged. For a deployed host, the flip names the deployed revision and is checked against the live `/.well-known/openwop`. For a reference host run on loopback, the flip names the build and says the host is a reference host, never "deployed".

### §E. Sunset

1. **Anchor.** A witness bundle qualifies only if its addition to `evidence/rfc-witnesses/` on `origin/main` first-parent (`git log --diff-filter=A`, the anchor rule `spec/v2/core/overview.md` §"v1 end-of-support" already uses) is earlier than `endOfSupportNotBefore` in `evidence/v1-end-of-support.json` as generated at evaluation time. `generatedAt` inside the bundle is never the anchor, because nothing signs it. A bundle not yet on `main` (the flip PR itself) is evaluated as of the evaluation date.
2. **Freeze.** After v1 end-of-support no new witness bundle qualifies. An RFC already `Accepted` on one stays `Accepted`: its committed bundle keeps qualifying, and §A.1 is evaluated at the bundle's own published suite version, so removing v1 scenario files from the tree later does not strand it. An RFC not yet `Accepted` whose marked id is still major-1-only then has no route through this branch. Its author amends the row, finds a v2 witness, or withdraws the requirement. The rule never extends itself.

### §F. Examples

**Positive.** The Postgres reference host publishes an Ed25519 `certification-bundle` key in its v1 `signingKeys[]`. The steward cuts `--target-major 1` on published suite 2.42.8 and commits the result as `evidence/rfc-witnesses/0218-postgres-major1-2.42.8.json`. Totals are 1098 / 305 / 234 / …, uncertified. `audit-checkpoint-signature.test.ts` has two rows, the `it` and the scenario, and both are `executed-pass` with no partial detail. RFC 0218's row carries `(major-1 witness)`. RFC 0218's flip cites the path, its sha256, `Evidence tier: tier-1`, the build and the totals. The gate credits `0218.checkpoint-signature-over-root` and discards the other 1097 passes.

**Negative.**

| Case | What the gate does |
| --- | --- |
| a `blocked` or `inapplicable` row in `audit-checkpoint-signature.test.ts` in that bundle | not credited (§C.2) |
| the X row carries `partial-witness:` | not credited (§C.1) |
| signed with a key absent from the captured discovery's `signingKeys[]`, or present but the signature fails | not credited (§B.6) |
| `discovery.sha256` differs from the captured document | not credited (§B.5) |
| a row edited after signing | not credited (§B.4, `witness-digest`) |
| `suite.targetMajor: 2`, or `suite.version` unreleased | not credited (§B.2, §B.3) |
| the id is also minted by a `[1, 2]` or `[2]` file | the marked row **fails** (§A.2) |
| the row lacks `(major-1 witness)` | this branch does not apply; rule 4 as today |
| the same uncertified bundle placed in `evidence/v2-host-bundles/` | no witness (§A.3, the 2.4.2 rule) |
| cited sha256 differs from the committed file | not credited (§D.1) |
| bundle committed to `main` after `endOfSupportNotBefore` | not credited (§E.1) |
| the bundle's other `executed-pass` rows, cited for another RFC's unmarked id | not credited (§D.2) |

## Compatibility

**`additive`**, corpus-governance only (`COMPATIBILITY.md` §2.1). Nothing on the wire changes. No host obligation, schema, error code or bundle field moves, and the verifier is not touched.

- **No `Accepted` RFC changes status.** Measured: no falsifiability row carries the marker today, so the branch credits nothing until an RFC opts in.
- **The gate loosens only for marked, eligible, clean, attributable, published, pre-sunset evidence**, and fails closed on each condition.
- **What tightens.** A marked row whose id is not major-1-only fails the gate (§A.2).
- **Pre-program RFCs.** RFCs numbered below 0167 remain outside the predicate. RFC 0111's acceptance and its README row in `evidence/rfc-witnesses/` are unaffected. That README gains a second section for this rule, and states that the 0111 bundle does not satisfy §C.2's reading unless re-checked. The 0111 bundle is not re-adjudicated.

## Conformance

**Existing coverage.**
- `v2-bundle-signature-attributable` pins signature attribution, including the `.v1-root` case.
- `v2-bundle-witness-preimage` pins the digest.
- `v2-colocated-companion` (coherence) is the pattern for a predicate branch tested on fixture directories.

**New, at `Active`.** Coherence scenario `v2-major1-witness-bundle.test.ts` (planned). It builds fixture witness bundles signed with throwaway keys, drives the predicate's branch as an importable function (as `scripts/lib/companion-pairing.mjs` is driven), and mints every `openwop.requirement.0224.*` id below. Each negative runs a second time with only its condition repaired, and must then pass, so no refusal passes for another reason. No id enters `floorScenarios` or a profile predicate.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1–2 only marked, major-1-only ids are eligible (`openwop.requirement.0224.eligible-major1-only`) (corpus) | the gate fails a marked row whose id is also minted by a `[1, 2]` or `[2]` file; an unmarked row is read exactly as today | the corpus gate, on fixtures | witnessable — unaided (corpus). Sabotage: drop the majors check, and a `[1, 2]`-minted marked id is credited. Planned in `v2-major1-witness-bundle.test.ts` |
| §A.3 an uncertified bundle in `evidence/v2-host-bundles/` still witnesses nothing (`openwop.requirement.0224.v2-dir-unchanged`) (corpus) | a fixture uncertified bundle placed in the v2 directory with a clean marked row is not credited | the corpus gate, on fixtures | witnessable — unaided (corpus). Sabotage: read the v2 directory through the new branch, and it is credited |
| §B.1–6 the bundle is v3, major 1, from a published suite, unedited, and attributable (`openwop.requirement.0224.bundle-verified`) (corpus) | not credited on: `targetMajor: 2`; an unreleased `suite.version`; an edited row; a `discovery.sha256` mismatch; a `keyId` absent from the captured `signingKeys[]`; a wrong-key signature | the corpus gate, on fixtures | witnessable — unaided (corpus). Six sabotages, each repaired singly |
| §B.7 the bundle measured the host at `discovery.url` | — | the operator, at cut time | unwitnessable — nothing in a signed bundle proves which process answered; the gate checks only that the URL equals the one the flip names. Same residual as every self-cut bundle (risk R2) |
| §C.1–2 the witnessing file is clean (`openwop.requirement.0224.witnessing-file-clean`) (corpus) | not credited when any row of a minting file is `executed-fail`, `blocked`, `inapplicable` or `skipped`, or the X row is `partial-witness:`; **credited** when only rows outside the file fail | the corpus gate, on fixtures | witnessable — unaided (corpus). Sabotage: read only the X row, and the blocked-sibling fixture is credited |
| §D.1 the flip cites the path and sha256 (`openwop.requirement.0224.citation-pinned`) (corpus) | not credited when the `Updated` line omits the path, cites a different sha256, or declares `corpus gate` | the corpus gate, on fixtures | witnessable — unaided (corpus) |
| §D.2 the bundle is never a certification (`openwop.requirement.0224.not-certification`) (corpus) | the gate fails when `INTEROP-MATRIX.md` cites any `evidence/rfc-witnesses/` path; the bundle's other passes are reported discarded | the corpus gate, on the committed tree | witnessable — unaided (corpus) |
| §E.1–2 the rule sunsets at v1 end-of-support (`openwop.requirement.0224.sunset`) (corpus) | a fixture bundle anchored after `endOfSupportNotBefore` is not credited; one anchored before is credited after the date, with §A.1 read at its suite version | the corpus gate, on fixtures (a fixture EOS date and a fixture anchor) | witnessable — unaided (corpus) |

## Security

- **Threat.** A host cherry-picks a passing row from a failing run. §C.2 refuses any unclean row in the witnessing file. §B.4 and §B.6 make the rows and the key the host's own signed statement. The totals are stated in the flip, so a reader sees how much of the run failed.
- **Threat.** A steward-signed bundle for a steward host. This is the tier-1 limit, and it is not new. The flip names the tier, and GOVERNANCE forbids calling it independent.
- **Threat.** The marker is applied to a requirement that also binds v2 hosts, so a v1 witness stands in for a v2 obligation. §A.1(b) refuses any id with a v2 minting file. What a regex cannot decide is whether a requirement *should* have a v2 scenario. The marker makes that claim explicit and reviewable (risk R1). It does not make a false claim impossible, and this RFC does not claim it does.
- **No new trust anchor.** No harness key or seam is added. The bundle's key is the host's published v1 key.
- **No secret material** enters `evidence/`. A bundle carries public keys and results only, as today.

## Alternatives considered

1. **Certify the v1 host at major 1.** Measured infeasible before v1 end-of-support: 234 blocked rows on a strict dry run, about 220 of them seams and harness pieces unrelated to RFC 0218. It would also buy a certification claim no one needs for a host whose major is ending.
2. **Do nothing, and `deferred:` the box.** `deferred:` is an escape for an acceptance box, not for rule 4, so RFC 0218 stays `Active` forever and loses the route at 2026-12-04. The practical outcome is RFC 0200 §C's move: strip the id from the row so the gate never looks. That leaves an unchecked MUST, which is worse than a checked narrow rule.
3. **Credit uncertified bundles in `evidence/v2-host-bundles/`.** Rejected. That is hole 4 closed in 2.4.2, and it reopens for every id, not one closed class.
4. **Give the audit-log family a v2 home and promote the scenario to `[1, 2]`.** At major 2 the scenario gates on a profile claim no v2 document defines. On every v2 host it would record `inapplicable`, which witnesses nothing. Defining a v2 audit-log profile is a normative addition in its own right and a separate RFC (Unresolved question 5). This RFC does not preclude it: once an id gains a v2 minting file, §A.1 stops applying.
5. **A per-RFC steward exception list in the gate**, as RFC 0111 was decided by hand. An allowlist hides the criterion in a list. A rule states the criterion and lets a script check every instance.
6. **Pair the witness with a certified v2 bundle of the same host**, as RFC 0216 pairs a companion. The Postgres and SQLite hosts are v1-only, so there is no v2 bundle to pair with.

## Unresolved questions

1. **`inapplicable` inside the witnessing file.** §C.2 refuses it outright. A scenario file whose later leg is a gated SHOULD, recorded `inapplicable` with a reason, would disqualify an otherwise clean witness. `audit-checkpoint-signature.test.ts` has one leg, so this does not bite today. Should a reasoned `inapplicable` on a leg that is not X be admitted? Proposed answer: no, not until a case exists.
2. **Where §A.1 is evaluated.** This Draft evaluates it at the bundle's published suite version, which is stable and freezes cleanly (§E.2). The alternative is the current tree, which would retract a credit when a file is later promoted to `[1, 2]`. Is a retraction at promotion wanted, so that a promoted id must be re-witnessed at major 2?
3. **A floor under the rest of the bundle.** Should the bundle also be required to certify `openwop-discovery-core`, so the host is at least a reachable, well-formed v1 host? It costs nothing on a working host and refuses a witness from a host that is broken at the front door. It has not been measured on the Postgres dry run.
4. **Tier floor.** Is tier-1 (a reference host on loopback) enough for this branch, as it is for rule 4's first branch today? Or should a major-1 witness require a deployed host?
5. **A v2 home for audit-log integrity** (Alternative 4). Should the corpus open that RFC, making this rule unnecessary for RFC 0218?
6. **The approval count at `Active`.** This RFC amends the Accepted predicate, which GOVERNANCE §"Amendments" treats as the decision rule and which needs two maintainer approvals. One maintainer exists. The sole-steward paragraph permits recording an approval-count waiver, and `check-waiver-authority.mjs` requires it to be named. That is decided at the `Active` flip, after this window. The comment window itself is not shortened.

## Implementation notes (non-normative)

- **Order at `Active`.**
  1. Extract the branch into `scripts/lib/major1-witness.mjs`, importable the way `companion-pairing.mjs` is, so the coherence test drives the same code.
  2. Wire it into rule 4 of `check-accepted-predicate.mjs` as a third branch, consulted only for rows carrying `(major-1 witness)`.
  3. Add the INTEROP-MATRIX path check (§D.2).
  4. Add `v2-major1-witness-bundle.test.ts`.
  5. Amend RFC 0174 §B.1, add the GOVERNANCE bullet, and add the README section.
  6. RFC 0174's header gains an `**Amended by**` row naming RFC 0224. It is added when this RFC is `Accepted`, and not at `Draft` or `Active`.
  7. Run the regen chain.
- **Verification reuses the suite.** §B.4–6 are the published suite's `--verify` (`conformance/src/lib/certification-bundle-v3.ts`). The gate calls the same functions from the workspace suite, and records the published version it checked against. It does not re-implement the preimage.
- **§B.3 and §E.1 need git history.** CI already runs `openwop:check` with `fetch-depth: 0` and fetches `main` (#1274), for the v1 end-of-support clock. The tag tree is read with `git show <tag>:conformance/scenario-majors.json` and `git show <tag>:conformance/requirements.json`.
- **Sabotages to run and record at `Active`, each reverted:**
  - a blocked sibling row in F (credited → must not be);
  - a wrong-key signature;
  - an id also minted by a `[1, 2]` file;
  - an uncertified bundle in the v2 directory;
  - an unreleased suite version;
  - a stale cited sha256;
  - a post-EOS anchor.
- **RFC 0218's route after `Active`.** First, the Postgres host publishes a `certification-bundle` key in its v1 `signingKeys[]`; that work is in flight in `openwop-examples` and not on its `main`. Then the steward cuts `--target-major 1` on a published suite at or after 2.42.7, commits the bundle under `evidence/rfc-witnesses/`, and adds `(major-1 witness)` to RFC 0218's row in the flip PR.

## Acceptance criteria

- [ ] reason: set at `Active`. The comment window closes 2026-10-05, and the unresolved questions are answered or carried.
- [ ] reason: set at `Active`. RFC 0174 §B.1 carries the third branch, `GOVERNANCE.md` §"Acceptance evidence tiers" carries the bullet, and `evidence/rfc-witnesses/README.md` carries the section.
- [ ] reason: set at `Active`. `check-accepted-predicate.mjs` implements §A–§E and stays green on the committed evidence, with no `Accepted` RFC changing status.
- [ ] reason: set at `Active`. `v2-major1-witness-bundle.test.ts` mints every `openwop.requirement.0224.*` id in §Falsifiability, every sabotage in the implementation notes is run and recorded, and `evidence/corpus-ledger.json` carries each `executed-pass`.
- [ ] reason: set at `Accepted`. The branch has credited one real witness: a committed major-1 witness bundle satisfying §B–§D, cited by a flip. RFC 0218's is the expected first.
- [x] CHANGELOG entry (filing).

## References

- RFC 0174 §B.1 (the predicate); `scripts/check-accepted-predicate.mjs`.
- RFC 0168 §E.1–§E.3 (bundle v3, signature, attribution, including `.v1-root`); RFC 0148 §C (witness digest).
- RFC 0147 §A.6 (high-risk window); `GOVERNANCE.md` §"Acceptance evidence tiers", §"Deployed, not merged", §"Sole-steward operation", §"Amendments".
- RFC 0216 (the colocated companion, a narrow branch of the same rule); RFC 0191 (reciprocal marker over a regex).
- RFC 0111 (`evidence/rfc-witnesses/0111-myndhyve-major1-2.42.1.json`, the pre-program precedent); RFC 0200 §C (the non-gating carve-out); RFC 0218 (the affected RFC); RFC 0207 (ids with a v2 route, not affected).
- `conformance/scenario-majors.json`, `conformance/requirements.json`, `evidence/v1-end-of-support.json`, `spec/v2/core/overview.md` §"v1 end-of-support".
