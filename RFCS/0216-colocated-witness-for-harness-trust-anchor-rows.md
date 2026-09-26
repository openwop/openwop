# RFC 0216: a colocated companion bundle is marked, and witnesses only the rows that need the suite's own issuer

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0216                                                            |
| **Title**         | a colocated companion bundle is marked, and witnesses only the rows that need the suite's own issuer |
| **Status**        | `Accepted`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-26                                                      |
| **Updated**       | 2026-09-26: **`Active → Accepted`**, provisional, because the RFC 0156 §B review is owed (`docs/WAIVER-RETROSPECTIVE-REGISTER.md` row 0216, `not-reviewed`). Evidence tier: corpus gate — no host tier. The mechanism is suite- and gate-side (openwop#1592, conformance 2.40.2 cycle). Every `openwop.requirement.0216.*` row is `executed-pass` in `evidence/corpus-ledger.json` from the coherence scenario `v2-colocated-companion`, with five sabotages run red. `check-harness-trust-anchors` is in `openwop:check` and green on the seven-row list. `check-accepted-predicate` implements §C and stays green, 43 Accepted before this flip. The one host-side box, a real openwop-app production/companion pair, is `deferred:` with its reason. Earlier: 2026-09-26: **`Draft → Active`, and the scope was reduced**. Filed `Draft` the same day with the full window to 2026-10-03. On 2026-09-26 the steward directed that the window be waived: **comment window waived**, not run. **STEWARD OVERRIDE of RFC 0147 §A.6.** §A.6 names certification as a class whose window bootstrap waiver language MUST NOT shorten, and this RFC changes which bundle rows count as acceptance evidence. The override is recorded as its own row in `MAINTAINERS.md`, not folded under an earlier RFC's. Acceptance will be provisional, and the RFC 0156 §B review is owed. **Why the scope was reduced:** openwop#1581 applies RFC 0168 §C.1 to the harness issuer, so a production host whose `oidc` lane does not list it records the issuer rows `inapplicable` and can certify. That removed the need for the Draft's `witnessed-colocated` disposition (§B–§D of the Draft), and an `/architect` review struck it (see Alternatives 1). The Draft's `implementation.build` discovery member was struck too, because RFC 0147 §A freezes new optional wire members; it is gap G6. What remains is the evidence half: a companion bundle is marked, and the acceptance gate counts it only for the listed rows, only when it pairs with a certified bundle of the same image. |
| **Affects**       | new `spec/v2/harness-trust-anchors.json` + `spec/v2/harness-trust-anchors.schema.json` (mirrored into `@openwop/spec-artifacts`) · `schemas/v2/certification-bundle.schema.json` (`host.deployment`, optional) · `spec/v2/core/conformance.md` §"Bundle v3" (one row, one paragraph) · `GOVERNANCE.md` §"Deployed, not merged" (one bullet) · `conformance/src/lib/certification-bundle-v3.ts` (preimage) · `conformance/src/cli.ts` (`--as-colocated-companion`) · `scripts/check-accepted-predicate.mjs` (rule 4) · new `scripts/lib/companion-pairing.mjs` + `scripts/check-companion-pairing.mjs` · new `scripts/check-harness-trust-anchors.mjs` · new coherence scenario `v2-colocated-companion.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md`. One optional bundle member, which enters the preimage only when present, so every existing bundle digests byte-identically. No host wire surface changes. The acceptance gate gets stricter and fails closed. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Some v2 rows can run only if the host trusts an OIDC issuer whose signing key the **suite** holds. Seven such rows exist today, from RFC 0200 and RFC 0210. A production host must not trust that issuer: doing so is an authentication bypass. After openwop#1581 a production bundle records those rows `inapplicable`, so the witness has to come from a **colocated companion**: the deployed image, booted beside the harness and trusting the suite issuer. Today nothing marks a companion bundle as one. The acceptance gate therefore counts every row it passed, including public-surface rows a companion cannot witness because it does not serve the public front. This RFC:
- marks a companion bundle with a signed `host.deployment: "colocated-companion"`;
- makes the list of issuer rows a closed corpus file enforced by a gate;
- lets `check-accepted-predicate.mjs` count a companion only for listed rows, and only when the companion pairs with a certified bundle of the **same image digest**, signed under that bundle's published key and advertising an equivalent discovery document.

## Motivation

Facts verified on 2026-09-26 against corpus tip `c4208e51` and the committed bundles in `evidence/v2-host-bundles/`.

### 1. Seven rows need a trust anchor that a production host must refuse

`v2-lane-exp-only-bound.test.ts` and `v2-oidc-id-token-audience.test.ts` mint the rows below. Each needs the host to accept a credential signed by key material the suite runner holds. (`auth-oidc-user-bearer.test.ts` also reads the issuer, but it runs at major 1 only, so it never produces a bundle v3 row.)

| Row | Why it needs the anchor |
| --- | --- |
| `openwop.requirement.0210.exp-only-control-accepted` | a token the host must **accept**, with an `iat`/`exp` the suite chooses |
| `openwop.requirement.0210.exp-only-lifetime-bound` | a correctly signed token with `exp − iat` beyond the window and a back-dated `iat`. No real IdP mints one |
| `openwop.requirement.0210.exp-only-remaining-bound` | a correctly signed token with a forward-dated `iat` |
| `openwop.requirement.0210.credential-lifetime-code` | the refusal code on the token above |
| `openwop.scenario.v2-lane-exp-only-bound` | the scenario row |
| `openwop.requirement.0200.id-token-aud` | a same-audience token the host must accept before the foreign-audience refusal means anything |
| `openwop.scenario.v2-oidc-id-token-audience` | the scenario row |

openwop-app's ADR 0745 D4 (`host/oidcTrustGuard.ts`) stops a Cloud Run service at boot if it trusts a harness issuer, with no escape hatch. That is the correct posture. openwop#1581 makes it certifiable: a lane that does not list the harness issuer has not claimed the instrument, so the rows are `inapplicable` (RFC 0168 §C.1). The residual #1581 states is that a production bundle **witnesses none of these rows**. The witness has to come from a run whose lane lists the harness issuer.

### 2. The companion that supplies that witness is unmarked, and the gate counts all of it

On 2026-09-25 the steward cut a colocated companion. It is production's image, booted on loopback, trusting the suite's issuer. It is committed as `evidence/v2-host-bundles/openwop-app-colocated-companion.json`: suite 2.38.0, `226 / 0 / 19 / 193 / 0`, both claimed profiles certified. It is honest, and `INTEROP-MATRIX.md` labels it "the deployed image, **not the served surface**". But:

- **Nothing in the bundle says it is a companion.** `check-accepted-predicate.mjs` reads every certified bundle in the directory the same way. Measured on 2026-09-26: the companion is the **only** witness for 16 ids. These include RFC 0200's `prm-served`, `prm-consistent`, `challenge-401` and `challenge-403-scope`, which were measured at `http://127.0.0.1:18099` with Firebase Hosting and the Cloud Run front out of the path. GOVERNANCE §"Deployed, not merged" says a live-surface claim is witnessed on the deployed revision. On 2026-09-26 an INTEROP-MATRIX label briefly allowed that citation (openwop#1577), and a reviewer caught it (openwop#1583), not a gate. No Accepted RFC rests on those 16 ids yet; RFC 0200 is still `Active`. The hole is open, and nothing has fallen into it.
- **Its `host.build` is `{ "kind": "commit" }`,** not the image digest its matrix note cites. A commit does not name the bytes that ran, and two builds of one commit need not be the same artifact.
- **It is signed with a throwaway key** (`openwop-app-colocated-companion-20260926025953`), published only in the companion's own loopback discovery. For attribution to the production operator it attests integrity only (conformance.md §"Bundle v3").

### 3. Precedent for "same code, different instance", and its limit

GOVERNANCE §"Acceptance evidence tiers" already admits a side revision for one class of row: "A seam-gated requirement may be witnessed on a side revision when the seam is a PRECONDITION, not when it is in the path being asserted on … **The line is where the seam sits relative to the assertion.**" A harness trust anchor has the same shape. The trusted issuer is a precondition; the code asserted on (the host's token verifier) is the image's own. This RFC draws the line GOVERNANCE already draws, and makes the gate enforce it: a companion never stands in for a row whose path runs through the served front.

## Proposal

### §A. The harness-trust-anchor list is closed, exact, and gate-kept

1. **Definition.** A *harness trust anchor* is a precondition under which the host must accept a credential or signature made with key material **the suite runner holds**. A host serving production traffic cannot meet it without granting the runner the power to authenticate as anyone the anchor covers. The anchor vocabulary is closed. It has one member, `oidc-test-issuer`: the host lists `OPENWOP_TEST_OIDC_ISSUER_URL` among the `issuers` of an advertised `oidc` lane.

2. **The list is a corpus file.** New `spec/v2/harness-trust-anchors.json`, validated by `spec/v2/harness-trust-anchors.schema.json` and mirrored into `@openwop/spec-artifacts`. Each entry is `{ "requirementId", "scenario", "anchor", "rfc" }` with `additionalProperties: false`. The initial content is the seven rows in §A.5, each with `anchor: "oidc-test-issuer"` and `rfc: "0216"`.

3. **The list is closed by a gate, not by review.** New `scripts/check-harness-trust-anchors.mjs`, wired into `openwop:check`, fails when:
   - (a) an entry's `requirementId` is not an exact id matching `^openwop\.(requirement|scenario)\.[a-z0-9.-]+$`;
   - (b) an entry's `anchor` is outside the schema's closed enum;
   - (c) the list differs, in either direction, from the union of the `### Harness-trust-anchor rows` tables of every `Active` or `Accepted` RFC, or an entry's `rfc` is not one of those RFCs;
   - (d) the named scenario does not mint the id (per `conformance/requirements.json`), or does not gate on the anchor. For `oidc-test-issuer`, that means calling `harnessClaimed(` from `conformance/src/lib/harness-issuer.ts` (openwop#1581);
   - (e) the scenario appears in any profile's `floorScenarios` (`spec/v2/profiles.json`). **No floor row is eligible.** A companion can therefore never decide a profile verdict.

4. Any later RFC that adds a row carries its own table and extends the list in the same PR. The RFC 0147 §A.6 full window applies to such an RFC, because it widens what a companion may witness.

5. The initial list follows.

### Harness-trust-anchor rows

| Requirement id | Scenario | Anchor |
| --- | --- | --- |
| `openwop.requirement.0210.exp-only-control-accepted` | `v2-lane-exp-only-bound.test.ts` | `oidc-test-issuer` |
| `openwop.requirement.0210.exp-only-lifetime-bound` | `v2-lane-exp-only-bound.test.ts` | `oidc-test-issuer` |
| `openwop.requirement.0210.exp-only-remaining-bound` | `v2-lane-exp-only-bound.test.ts` | `oidc-test-issuer` |
| `openwop.requirement.0210.credential-lifetime-code` | `v2-lane-exp-only-bound.test.ts` | `oidc-test-issuer` |
| `openwop.scenario.v2-lane-exp-only-bound` | `v2-lane-exp-only-bound.test.ts` | `oidc-test-issuer` |
| `openwop.requirement.0200.id-token-aud` | `v2-oidc-id-token-audience.test.ts` | `oidc-test-issuer` |
| `openwop.scenario.v2-oidc-id-token-audience` | `v2-oidc-id-token-audience.test.ts` | `oidc-test-issuer` |

### §B. A companion bundle says so, and cannot stop saying so

6. `host` in bundle v3 gains optional `deployment`, a closed enum. Its only member is `"colocated-companion"`; when the member is absent, the bundle measures the served host. The CLI sets it under `--certify --as-colocated-companion`, and never otherwise.

7. **It is inside the signed digest.** When `deployment` is present, the `witnessSha256` preimage is the object `{ "rows", "relaxations"?, "deployment" }`, where `relaxations` appears only when non-empty, as RFC 0173 set up. When neither is present, the preimage is the bare row array as today. The signature covers `witnessSha256` (`SIGNATURE_OVER`), so a signed companion cannot lose the marker without failing `--verify` with `witness-digest`, and every existing bundle digests byte-identically.

8. The marker changes nothing about certification. A companion certifies, or not, under the existing rules. What it changes is what the acceptance gate may take from it (§C).

### §C. The acceptance gate counts a companion only for listed rows, and only when it pairs

9. **`check-accepted-predicate.mjs` rule 4** reads a certified bundle with `host.deployment: "colocated-companion"` as follows. Its `executed-pass` rows supply a witness **only** for ids on `harness-trust-anchors.json`, and only when some committed, certified bundle **P** in `evidence/v2-host-bundles/` without the marker (a served-host bundle) pairs with it. All of the following must hold:
   - (a) **The same host.** `host.name` and `host.vendor` are equal.
   - (b) **The same image.** Both `host.build.kind` values are `"image-digest"`, and the two `id`s are byte-equal.
   - (c) **Attributable to P's operator.** The companion's `signature.keyId` names a key in P's captured `discovery.document.signingKeys[]` with `use: "certification-bundle"`, and the companion's signature verifies under that key's `publicKey`. A key published only by the companion is refused.
   - (d) **The same configuration, as far as discovery shows.** The two captured discovery documents are equal under canonical JSON after exactly two normalisations. First, each document's origin (from `discovery.url`) is replaced with one placeholder in every string value, the rule `conformance/src/lib/host-public-origin.ts` `withoutOrigins` already applies. Second, the `issuers` member of the `auth.lanes[]` entry whose `lane` is `"oidc"` is removed from both. Everything else must match, including that lane's `revocation`, `revocationWindowSeconds` and `minimumAssurance`, the other lanes, and `signingKeys[]`. That is what makes the companion's `exp-only 3600` the same claim production makes.

   Its other rows count toward nothing, however certified the bundle is. A row the gate discards this way is reported, so a flip author can see which evidence did not count.

10. **The committed unmarked companion.** `openwop-app-colocated-companion.json` predates the marker. The gate names it in a fixed list keyed by its `witnessSha256` (not by filename, so a renamed copy is still caught) and treats it as marked. It fails §C.9(b) and (c), so it now witnesses nothing. It stays committed as a historical record, and `INTEROP-MATRIX.md` keeps its label. This loses no acceptance: measured on 2026-09-26, none of its 16 companion-only ids is the only witness for any `Accepted` RFC.

11. A served-host bundle (no marker) is read exactly as today.

### §D. Normative prose

**`spec/v2/core/conformance.md` §"Bundle v3"**, one table row (`host.deployment`) and this paragraph:

> A bundle cut from a *colocated companion* (the served host's image, run beside the suite so it can trust a suite-held trust anchor that a served host MUST NOT trust) MUST carry `host.deployment: "colocated-companion"`. The member enters the `witnessSha256` preimage when present (`{ rows, relaxations?, deployment }`), so it cannot be removed from a signed bundle. A companion is evidence only for the requirements listed in `spec/v2/harness-trust-anchors.json`, and only when it pairs with a certified served-host bundle of the same `image-digest` build, signed under a key that bundle's discovery publishes, whose discovery document is equivalent except for its origin and the `oidc` lane's `issuers`. A host serving production traffic MUST NOT list a suite-held trust anchor among the trust roots it advertises. A reference or test host MAY, and its bundle then witnesses the listed rows directly.

**`GOVERNANCE.md` §"Deployed, not merged"**, a new bullet after the seam-precondition bullet:

> - **A harness trust anchor is a precondition in the same sense. It is witnessed on a colocated companion of the deployed image, never on the deployed instance.** A requirement whose observation needs the host to trust key material the suite holds (`spec/v2/harness-trust-anchors.json`) cannot be witnessed on a production instance without making that instance accept credentials a test runner can mint. A companion booted from the deployed image digest, trusting the suite's anchor and configured otherwise identically, runs the same verifier code production runs. It satisfies this section for the listed rows **only**, never for a row whose path runs through the served front. A companion MUST NOT be reachable from the public internet, and MUST NOT be given production data stores or production credentials other than the bundle-signing key. `check-accepted-predicate.mjs` enforces the row restriction and the pairing (RFC 0216 §C). The network and data rule is the operator's obligation.

### §E. Examples

**Positive.** P is openwop-app's production bundle: `host.build: { "kind": "image-digest", "id": "sha256:547c…" }`, signed `openwop-app-bundle-3`, `oidc` lane `issuers: ["https://securetoken.google.com/…"]`, and the seven rows `inapplicable` under #1581. C is the companion: the same `host.build`, `host.deployment: "colocated-companion"`, signed under `openwop-app-bundle-3`, `oidc` lane `issuers: ["https://securetoken.google.com/…", "http://127.0.0.1:…/issuer"]`, and the seven rows `executed-pass`. The gate counts C's seven rows. It does not count C's `0200.prm-served`. That row counts only from P, if P passed it through the served front.

**Negative:**

| Case | What the gate does |
| --- | --- |
| C's `0200.prm-served` `executed-pass` | not counted; not on the list (§C.9) |
| C with `host.build.kind: "commit"` | nothing counted (§C.9(b)) |
| C signed with a key only C's discovery publishes | nothing counted (§C.9(c)) |
| C advertising `exp-only` with a 300 s window while P advertises 3600 s | nothing counted (§C.9(d)) |
| C with no committed P of the same host | nothing counted (§C.9) |
| C with `host.deployment` stripped after signing | `--verify` refuses: `witness-digest` (§B.7) |
| the committed 2026-09-25 companion | nothing counted (§C.10) |
| a list entry `openwop.requirement.0200.*` | `check-harness-trust-anchors` fails (§A.3(a)) |
| a list entry for a floor scenario | `check-harness-trust-anchors` fails (§A.3(e)) |

## Compatibility

**Classification: `additive`**, per `COMPATIBILITY.md` §2.1. Bundle v3 has absorbed two optional additions without a version bump: row `evidence` (2.34.0, RFC 0158) and `host.relaxations` (2.35.0, RFC 0173). Both enter the preimage only when present, and this RFC follows that pattern.

- **Every existing bundle stays valid and digests byte-identically.** None carries `host.deployment`.
- **Older verifiers.** A verifier on a suite before this change rejects a bundle carrying `host.deployment` at schema validation (the `host` object is closed). That fails closed: it cannot misread a companion as a served-host bundle. Consumers pin `@openwop/spec-artifacts` (RFC 0171 G6).
- **No host obligation changes.** No discovery member is added, and no `MUST` on a served host is relaxed. The `MUST NOT` in §D, that a host serving production traffic does not list a suite-held trust anchor, restates ADR 0745's posture as corpus text. It binds no reference or test host (which MAY list the anchor), and a production host that already lists one is the authentication bypass the rule names.
- **What tightens is corpus-side.** Rule 4 counts less from a marked or listed companion. Measured: no `Accepted` RFC loses its witness.

## Conformance

**Existing coverage.** `v2-bundle-witness-preimage` (coherence) pins the preimage, `v2-bundle-signature-attributable` pins attribution, and `certification-bundle-v3.test.ts` (lib) pins the verifier. None of them knows the marker.

**New:**
- `conformance/src/coherence/v2-colocated-companion.test.ts` (corpus gate; never reaches a host bundle). It builds P/C fixture pairs signed with throwaway keys, runs the predicate's pairing function and the anchor gate against fixture directories, and mints every `openwop.requirement.0216.*` id below. Each negative runs a second time with only that condition repaired, and must then pass, so no refusal passes for another reason.
- `scripts/check-harness-trust-anchors.mjs` in `openwop:check`.
- The `--as-colocated-companion` flag and the preimage change, pinned by `certification-bundle-v3.test.ts`.

No requirement id enters `floorScenarios` or a profile predicate.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.3 the anchor list is closed and exact (`openwop.requirement.0216.anchor-list-closed`) (corpus) | the anchor gate exits 1 on a wildcard id, an anchor outside the enum, a list/table mismatch, a scenario that does not gate on `harnessClaimed(`, and a floor scenario, each named | the corpus gate, unaided | witnessable — unaided (corpus): five sabotages, each repaired singly |
| §B.7 the marker is inside the signed digest (`openwop.requirement.0216.deployment-in-preimage`) (corpus) | stripping `host.deployment` from a marked bundle changes `witnessDigest`; a bundle without it digests to the pre-RFC value | the suite, on fixtures | witnessable — unaided (corpus). Sabotage: leave `deployment` out of the preimage, and the stripped bundle digests equal |
| §C.9 a companion counts only for listed rows (`openwop.requirement.0216.companion-anchor-rows-only`) (corpus) | a paired companion's `0200.prm-served` is discarded, and its `0210.exp-only-lifetime-bound` is counted | the corpus gate, on fixtures | witnessable — unaided (corpus). Sabotage: drop the list filter, and `prm-served` counts |
| §C.9(a)/(b) the same host and image digest (`openwop.requirement.0216.companion-same-image`) (corpus) | nothing counted when either build is `commit`, when both are `image-digest` with one byte differing, or when `host.name` differs | the corpus gate, on fixtures | witnessable — unaided (corpus). Sabotage: compare `id` without `kind`, and the `commit` pair counts |
| §C.9(c) signed under a key P publishes (`openwop.requirement.0216.companion-attributable`) (corpus) | nothing counted when the companion's `keyId` is absent from P's `signingKeys[]`, or when the key is present but the signature does not verify under it | the corpus gate, on fixtures | witnessable — unaided (corpus) |
| §C.9(d) equivalent discovery (`openwop.requirement.0216.companion-equivalent`) (corpus) | nothing counted on a differing `revocationWindowSeconds` or a differing non-`oidc` lane; **counted** when only the origin and the `oidc` `issuers` differ | the corpus gate, on fixtures | witnessable — unaided (corpus) |
| §C.10 the committed unmarked companion witnesses nothing (`openwop.requirement.0216.legacy-companion`) (corpus) | the live evidence directory yields no witness from `openwop-app-colocated-companion.json` | the corpus gate, on the committed tree | witnessable — unaided (corpus) |
| §D a companion is not internet-reachable and holds no production data | — | — | unwitnessable — an operator's network and data topology are not observable from the bundle or from the suite. Stated as an operator obligation, as GOVERNANCE states the seam rule. Risk R3 |
| §D a host serving production traffic does not list a suite-held anchor | a production host's `oidc` lane lists the harness issuer | the host | unwitnessable — the suite cannot tell a production deployment from a test one by the wire alone; #1581 treats a listing as claiming the instrument, which is what makes it visible in a bundle. Risk R2 |

## Alternatives considered

1. **A `witnessed-colocated` row disposition (this RFC's Draft).** A production bundle would have recorded the issuer rows as `witnessed-colocated` citing a companion, and that disposition would not have denied certification. After #1581 the production row is honestly `inapplicable` and nothing needs rewriting. The disposition would also have been a new state that stops a row from blocking certification, which is exactly the general escape risk R1 fears. Struck at `Active`.
2. **`implementation.build` in discovery (this RFC's Draft §D).** It would bind the served digest to the served surface. But it is a new optional wire member while RFC 0147 §A's freeze is in force, and it is self-reported anyway. Gap G6.
3. **Do nothing.** The gate keeps counting a companion's public-surface rows. openwop#1583 shows a human catching it once, and that does not scale.
4. **Move the companion out of `evidence/v2-host-bundles/`.** That closes the hole for one file and not for the next one. The marker plus pairing closes it for every file.
5. **Let production trust a test issuer behind a guard.** ADR 0745 D4 chose "no escape hatch" deliberately, and the corpus must not reward building one.

## Unresolved questions

1. **Configuration drift outside discovery.** Two instances of one image can differ by an environment flag that discovery never shows. §C.9(d) catches every difference discovery exposes, and nothing else. This is residual operator trust, the same trust any self-cut bundle carries (risk R2, gap G3).
2. **The equivalence set against a real pair.** The normalisation (origin plus `oidc` `issuers`) has not been measured on a real production/companion pair of the same image. If the first real pair differs in a member that is a legitimate consequence of the anchor, extending the normalisation is an amendment to this RFC, under its own window (gap G3).

## Implementation notes (non-normative)

- Order: schemas and the list → `generate-spec-artifacts.mjs --write` → `certification-bundle-v3.ts` (type, preimage) → `cli.ts` flag → `check-harness-trust-anchors.mjs` + `openwop:check` wiring → rule 4 in `check-accepted-predicate.mjs`, with the pairing logic in an importable module so the coherence test drives the same code → coherence test → `generate-requirement-registry.mjs --write`, `check-spec-coherence.mjs --write` (corpus ledger), `generate-protocol-status.mjs --write`.
- Sabotages run 2026-09-26, each reverted after its run: drop the anchor-list filter in `companion-pairing.mjs` (`prm-served` counts); compare `build.id` without `kind` (the `commit` pair counts); skip the `edVerify` (the wrong-key companion counts); drop the `oidc`-issuers normalisation (the base stops pairing); drop `deployment` from `witnessDigest`'s preimage (§B.7 and every pairing leg go red, because the gate's prose preimage then disagrees with the suite's). The anchor gate's five clauses are sabotaged inside the test on every run. One real defect was found this way: an anchor outside the enum also fired (d), and the gate now leaves that finding to (b) alone.
- openwop-app runbook (register G4): the deploy pipeline records the Cloud Run image digest and cuts the production bundle with `host.build.kind: "image-digest"`. The companion boots that digest on loopback with memory storage, the production bundle-signing key and the harness issuer added to its `oidc` lane, and runs `--certify --as-colocated-companion --max-workers 1`.

## Acceptance criteria

- [x] `spec/v2/harness-trust-anchors.json`, its schema, and `host.deployment` in `schemas/v2/certification-bundle.schema.json` land, and `generate-spec-artifacts --check` passes.
- [x] `conformance.md` §"Bundle v3" and `GOVERNANCE.md` carry §D's prose, and `check-core-budget` stays green.
- [x] The preimage and `--as-colocated-companion` land in the suite.
- [x] `check-harness-trust-anchors.mjs` is in `openwop:check` and green on the seven-row list.
- [x] `check-accepted-predicate.mjs` implements §C, and is green on the committed evidence.
- [x] `v2-colocated-companion.test.ts` (openwop#1592) mints every `openwop.requirement.0216.*` id in §Falsifiability, with each sabotage run and recorded, and `evidence/corpus-ledger.json` carries each `executed-pass`.
- [x] CHANGELOG entry.
- [x] RFC 0156 §B retrospective review row filed `not-reviewed` — `docs/WAIVER-RETROSPECTIVE-REGISTER.md` row 0216. Until the review is recorded, `Accepted` is **provisional**.
- [ ] deferred: a real production/companion pair from openwop-app, committed and counted by the gate. Reason: it needs a production deploy that records the image digest (gap G4, which waits on the steward's `gcloud` re-auth). The mechanism is corpus-side and is witnessed by the corpus rows above. The pair is adoption, not correctness.

## References

- `spec/v2/core/conformance.md` §"Whose fact is the reason?", §"Bundle v3"; RFC 0168 §C.1 and §E.1; RFC 0148.
- `GOVERNANCE.md` §"Acceptance evidence tiers" → "Deployed, not merged".
- openwop#1581 (harness issuer as a claimed instrument), openwop#1577 and #1583 (the companion citation and its correction).
- `conformance/src/lib/certification-bundle-v3.ts` (`witnessDigest`), `conformance/src/lib/host-public-origin.ts` (`withoutOrigins`), `scripts/check-accepted-predicate.mjs` (rule 4).
- `evidence/v2-host-bundles/openwop-app-colocated-companion.json`; `INTEROP-MATRIX.md`.
- RFC 0200, RFC 0210 (the listed rows); RFC 0158 and RFC 0173 (optional-when-present preimage precedents); RFC 0171 G6; RFC 0147 §A and §A.6; RFC 0156 §B.
- openwop-app ADR 0745 D4 (`host/oidcTrustGuard.ts`).
