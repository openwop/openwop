# RFC 0216: a row that needs the suite's own issuer may be witnessed by a colocated companion of the deployed image

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0216                                                            |
| **Title**         | a row that needs the suite's own issuer may be witnessed by a colocated companion of the deployed image |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-26                                                      |
| **Updated**       | 2026-09-26 — filed `Draft`; the steward approved drafting it on 2026-09-26. **The public comment window runs in full, to 2026-10-03** (the 7-day window GOVERNANCE gives a backward-compatible normative addition). RFC 0147 §A.6 names **certification** as a risk class whose window bootstrap waiver language MUST NOT shorten, and this RFC changes what certifies: it admits one new disposition past RFC 0168 §E.1's bundle-wide `blocked` rule. **No waiver is requested and none is granted.** If the steward decides to move it earlier, that is an explicit override of §A.6, recorded in `MAINTAINERS.md` as an override row with an RFC 0156 §B review owed, as for RFC 0210, 0212 and 0215. It is not folded under any of those overrides. Nothing normative lands with this filing. |
| **Affects**       | **Lands when `Active`:** `spec/v2/core/conformance.md` §"Whose fact is the reason?" (one paragraph) and §"Bundle v3" (two table rows, one paragraph) · `GOVERNANCE.md` §"Acceptance evidence tiers" → "Deployed, not merged" (one bullet) · `schemas/v2/certification-bundle.schema.json` (one `result` member, one optional `totals` member, one optional `evidence` member, one optional `host` member) · `schemas/v2/capabilities.schema.json` (one optional `implementation` member) · new `spec/v2/harness-trust-anchors.json` + schema · new `scripts/check-harness-trust-anchors.mjs` · `scripts/check-accepted-predicate.mjs` · conformance (`--colocated-companion`, the verifier, the blocked detail of two scenarios, one new coherence test) · `@openwop/spec-artifacts` mirror via `generate-spec-artifacts.mjs`. **Lands with this filing:** this RFC, its two registers, the `RFCS/README.md` row, a CHANGELOG entry. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` and `spec/v2/core/overview.md` §0 (a member added to a closed vocabulary, optional members added to closed objects). Older verifiers refuse a bundle that carries the new member, which fails closed. Classified in full in §Compatibility |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Some v2 requirement rows can run only if the host trusts an OIDC issuer the **suite** holds the signing key for. Today there are seven such rows, from RFC 0200 and RFC 0210. A production host that correctly refuses to trust a test issuer records them `blocked`, and a bundle with a `blocked` row never certifies (RFC 0168 §E.1). So the honest production bundle can never certify, and none of its other rows, including the public-surface rows that only the served front can witness, can count toward any RFC. This RFC adds one bundle disposition, `witnessed-colocated`. A production bundle MAY record it only for a row on a closed, gate-kept list of **harness-trust-anchor** requirements, and only by citing a certified companion bundle cut from the **same image digest**, with an equivalent discovery document, signed under a key the production host publishes. The companion's other rows count toward nothing.

## Motivation

### 0. Relation to openwop#1581, and what this RFC is for if that lands (added 2026-09-26)

openwop#1581 (open when this RFC was filed) resolves the **certification** half of the problem below by a different mechanism, and one already grounded in the corpus. RFC 0168 §C.1 treats an unclaimed suite instrument as `inapplicable`, never `blocked`, and #1581 applies that to the harness issuer, which a host claims by listing it in the lane's `issuers[]`. An honest production host that lists only its real issuer then records the harness-trust-anchor rows `inapplicable`, and its bundle can certify. If #1581 lands, §2's "can never certify" no longer holds.

This RFC is still needed for the **evidence** half, which #1581 does not touch (§3). A companion bundle carries no marker that it is a companion, so `check-accepted-predicate` counts **every** row it records, including public-surface rows such as RFC 0200 box 276's `prm-served` and `challenge-401`, which a companion booted beside the harness cannot have witnessed on the served surface. On 2026-09-26 an INTEROP-MATRIX label briefly allowed exactly that citation (openwop#1577), and a human reviewer caught it (openwop#1583), not a gate. The signed companion marker and the digest binding below are what make the gate catch it.

**If #1581 lands, the reviewer question this RFC poses** is whether a production bundle should keep recording those rows as `inapplicable` (#1581), which is honest but says nothing about *where* they were witnessed, or should record them as `witnessed-colocated` and cite a digest-bound companion (§Proposal), which ties the production bundle to the evidence. The companion marker (§3's hole) is needed under either answer. See Unresolved question 7.

Facts verified on 2026-09-26 against corpus tip `718d67fc` and the committed bundles in `evidence/v2-host-bundles/`.

### 1. The bundle-wide `blocked` rule has no exception, and it should not grow a general one

`spec/v2/core/conformance.md` §"Whose fact is the reason?":

> Use `inapplicable` only when the requirement does not bind that host. A missing fixture, unreadable corpus file, or other suite-side failure MUST be `blocked`, never `inapplicable`; a suite with a blocked row MUST NOT issue a certification (RFC 0168 §E.1).

`conformance/src/cli.ts` implements it per claimed profile as `certified = !relaxedProfile(p) && verdictFor(p).certifiable && !notHeld.has(p) && !rejected && totals3.blocked === 0`. The last term is bundle-wide: one `blocked` row anywhere denies every profile. `scripts/check-accepted-predicate.mjs` then reads rows only from committed bundles whose claimed profiles **all** certify (the `uncertified` branch), so an uncertified bundle supplies no witness for any RFC.

The rule is right. "We could not check" and "we checked and it holds" are the two states RFC 0148 exists to keep apart. This RFC keeps the rule and names one class of row where the check *can* be made, on the same code, but not on the served instance.

### 2. Seven rows need a trust anchor that a production host must refuse

`grep -l OPENWOP_TEST_OIDC_ISSUER_URL conformance/src/scenarios/*.test.ts` returns three files. `auth-oidc-user-bearer.test.ts` runs at major 1 only (`conformance/scenario-majors.json`), so it never reaches a v3 bundle. The other two mint the following rows. Each records `blocked` when the variable is unset:

| Row | Scenario | Why it needs the anchor |
| --- | --- | --- |
| `openwop.requirement.0210.exp-only-control-accepted` | `v2-lane-exp-only-bound.test.ts` | a token the host must **accept**, with an `iat`/`exp` the suite chooses |
| `openwop.requirement.0210.exp-only-lifetime-bound` | same | a correctly signed token with `exp − iat` past the window and a back-dated `iat`. No real IdP mints that |
| `openwop.requirement.0210.exp-only-remaining-bound` | same | a correctly signed token with a forward-dated `iat` |
| `openwop.requirement.0210.credential-lifetime-code` | same | the refusal code on the token above |
| `openwop.scenario.v2-lane-exp-only-bound` | same | the scenario row, which inherits the legs' disposition |
| `openwop.requirement.0200.id-token-aud` | `v2-oidc-id-token-audience.test.ts` | a same-audience token the host must accept, before the foreign-audience refusal means anything |
| `openwop.scenario.v2-oidc-id-token-audience` | same | the scenario row |

**The five `openwop.requirement.*` ids alone are not enough; the two `openwop.scenario.*` rows are also needed.** Without them a production bundle still carries two `blocked` rows and still cannot certify. The companion bundle records all seven, one row per id.

Each of these rows requires the host to accept a credential signed by key material the **suite runner** holds. openwop-app's ADR 0745 D4 (`host/oidcTrustGuard.ts`) makes a Cloud Run service exit at boot if it trusts a harness issuer, with "no escape hatch", because a runner-held signing key trusted by an internet-reachable service is an authentication bypass. That is the correct posture, and its consequence is that openwop-app's production bundle can never certify once it advertises an `oidc` lane. Its public-surface rows (`openwop.requirement.0200.prm-served`, `.prm-consistent`, `.challenge-401`, `.no-challenge-on-nondisclosure-404`) measured `executed-pass` on the live site and still count toward nothing.

**The incentive is backwards.** Today the only way for this host to certify in production is to trust a test issuer in production, which is the vulnerability the guard exists to prevent. A certification rule that rewards an authentication bypass is a defect in the rule.

### 3. The workaround in use has two soundness holes this RFC must close, not bless

On 2026-09-25 the steward cut a **colocated companion**: production's image, pulled by digest (`sha256:547c729d…`, verified equal to live revision `openwop-app-backend-00742-slg`, per `INTEROP-MATRIX.md`), booted beside the harness, trusting the suite's issuer, cut with `--max-workers 1`. It is committed at `evidence/v2-host-bundles/openwop-app-colocated-companion.json`: suite 2.38.0, `226 / 0 / 19 / 193 / 0`, both claimed profiles certified, all seven rows above `executed-pass`. It is honest, and INTEROP-MATRIX labels it "the deployed image, **not the served surface**". Reading it closely shows two problems:

- **Nothing in the bundle says it is a companion.** Its `host.build` is `{ "kind": "commit", "id": "bc0f13f1…" }`, not the image digest the prose cites, and its root carries no marker. `check-accepted-predicate.mjs` therefore reads it as an ordinary certified host bundle and counts **every** `executed-pass` row it carries toward rule 4, including `0200.prm-served`, `.prm-consistent`, `.challenge-401` and `.no-challenge-on-nondisclosure-404`. Those were measured at `http://127.0.0.1:18099`, with Firebase Hosting's rewrites and the Cloud Run front out of the path. GOVERNANCE §"Deployed, not merged" says a live-surface claim (*advertises*, *emits*, *refuses*) is witnessed by the deployed revision, and a loopback boot of the right image does not serve the deployed surface. Measured today: removing the companion from the evidence directory leaves `check-accepted-predicate` green (42 Accepted RFCs), so **no Accepted RFC rests on it alone yet**. RFC 0213's `Updated` field does cite it as a second witness for non-anchor rows. The hole is open, and nothing has fallen into it.
- **It is signed with a throwaway key** (`openwop-app-colocated-companion-20260926025953`) published only in the companion's own loopback discovery. Under conformance.md §"Bundle v3", a verifier resolves `keyId` "in the discovery document of the host the bundle is *about*". The companion's discovery document is about a process that no longer exists. For attribution to the production operator, it attests **integrity only**.

A disposition that pointed at this bundle as it stands would give an unattributed, unmarked bundle with a self-declared commit id the power to lift production's `blocked` rule. §C below is the set of conditions that make the pointer sound.

### 4. There is precedent for "same code, different instance" and its limit

GOVERNANCE §"Acceptance evidence tiers" already admits a side revision for one class of row: "A seam-gated requirement may be witnessed on a side revision when the seam is a PRECONDITION, not when it is in the path being asserted on … **The line is where the seam sits relative to the assertion.**" A harness trust anchor is the same shape. The trusted issuer is a precondition, and the code asserted on (the host's own token verifier) is the image's. The line this RFC draws is the one GOVERNANCE already draws, applied to a trust anchor instead of a seam. The companion never stands in for a row whose path runs through the served front.

## Proposal

### §A. The harness-trust-anchor list is closed, exact, and gate-kept

1. **Definition.** A *harness trust anchor* is a precondition under which the host must accept a credential or signature made with key material **the suite runner holds**. A host serving production traffic cannot meet it without granting the runner the power to authenticate as anyone the anchor covers. The anchor vocabulary is closed. It has one member, `oidc-test-issuer`: the host trusts `OPENWOP_TEST_OIDC_ISSUER_URL` as the trust root of an advertised `oidc` lane.

2. **The list is a corpus file.** New `spec/v2/harness-trust-anchors.json` (schema `spec/v2/harness-trust-anchors.schema.json`, mirrored into `@openwop/spec-artifacts`). The suite reads it from the digest-checked spec-artifacts peer, so an operator cannot extend it locally. Each entry is `{ "requirementId", "scenario", "anchor", "rfc", "substitutable" }`, with `additionalProperties: false`. `substitutable` names the discovery members the anchor necessarily changes (§C.10(g)). Initial content: the seven rows of §Motivation 2, each `anchor: "oidc-test-issuer"`, `rfc: "0216"`, `substitutable: ["auth.lanes[lane=oidc].issuers"]`.

3. **The list is closed by a gate, not by review.** New `scripts/check-harness-trust-anchors.mjs`, wired into `openwop:check`, fails when any of these holds:
   - (a) an entry's `requirementId` contains a wildcard, a prefix form, or anything outside `^openwop\.(requirement|scenario)\.[a-z0-9.-]+$`. Exact ids only.
   - (b) an entry's `anchor` is outside the schema's closed enum. Adding a member to the enum is a schema change, and the gate refuses one whose `rfc` does not define it.
   - (c) an entry's `rfc` names an RFC that is not `Active` or `Accepted`, or whose text has no `### Harness-trust-anchor rows` table listing that exact id. This RFC carries that table (§A.5). A later RFC that adds a row carries its own.
   - (d) the named `scenario` does not mint `requirementId`, or does not read the anchor's variable. An entry for a row that needs no anchor is refused.
   - (e) the scenario appears in any profile's `floorScenarios` (`spec/v2/profiles.json`). **No floor row may be anchor-eligible.** This makes §B.8 unconditional.
   - (f) the list and the union of every Active/Accepted RFC's `### Harness-trust-anchor rows` table differ in either direction.

4. **The eligible reason is exact.** When its anchor is not configured, a listed scenario MUST record `blocked` with a detail that begins `harness-trust-anchor:<anchor> —`, followed by the human reason. Only that reason is eligible for §B. A listed row that is `blocked` for any other cause stays `blocked` and denies certification as today. Examples of other causes: `v2-lane-exp-only-bound`'s window-under-120-s gate, or `v2-oidc-id-token-audience`'s "issuer set, but the host refused the same-audience token". The two scenarios' "variable is not set" branches gain the prefix at `Active`, and no other branch does.

5. The initial list is the table below. At `Active`, the gate in §A.3(c) reads it.

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

### §B. The disposition `witnessed-colocated`

6. **A sixth row result.** `results.requirements[].result` gains `witnessed-colocated`. It means: *this host's run could not observe the requirement because the observation needs a harness trust anchor this host correctly refuses; a certified companion run of the same image, cited on this row, observed it `executed-pass`.* A bundle MUST NOT record it for a row absent from `harness-trust-anchors.json`. The suite writes it, and only in the rewrite described in §B.7. An operator never writes it by hand, and the verifier re-derives every condition (§C).

7. **How it is recorded.** `--certify` gains `--colocated-companion <bundle.json>`, repeatable. After the run, for each row that is (i) on the list and (ii) `blocked` with the §A.4 prefix, the CLI looks for a companion that satisfies §C for that row. If it finds one, it rewrites the row to `witnessed-colocated`, keeps `scenario` and `assertions: 0`, and sets
   - `detail` to `witnessed-colocated: <anchor> — companion witnessSha256 <hex>` followed by the original anchor reason, and
   - `evidence.colocated` to `{ "companionWitnessSha256", "companionBuild": { "kind", "id" }, "companionSigningKeyId", "companionSuiteVersion", "companionDiscoverySha256" }`.

   A row the run recorded `executed-pass`, `executed-fail`, `inapplicable` or `skipped` is **never** rewritten. A companion cannot turn a production `executed-fail` into anything, and cannot make a row bind a production host whose discovery does not advertise the gating lane: that row is `inapplicable` in production and stays so. If no companion qualifies, the row stays `blocked` and the CLI names the first §C condition that failed.

8. **It unblocks, and it witnesses nothing on its own.** `witnessed-colocated` joins `CERTIFIABLE` (`conformance/src/lib/requirement-ledger.ts`), so it does not count as `blocked` for §E.1. It is **not** an `executed-pass`. It does not count toward `witnessCount`, a profile floor, or `assertionCount`, and it appears in `detail.nonPass[]`. Because §A.3(e) keeps every floor scenario off the list, no profile's floor verdict can depend on it. The requirement's witness is the companion's `executed-pass` row. The production row is a pointer to it.

9. **Totals.** `results.totals` gains optional `witnessedColocated` (integer ≥ 0). It is REQUIRED and equal to the row count when any row carries the result. The verifier recounts it, as it recounts the other five, and refuses a mismatch as `totals-mismatch`.

### §C. What makes a companion citable

10. A companion bundle **C** is citable from production bundle **P** for row *r* only when every condition below holds. The CLI checks them at `--certify`. `--verify` re-checks them from the embedded citation plus the companion file, and refuses P as evidence (not merely uncertified) when any fails.
    - **(a) C verifies.** It is bundle v3, its `witnessSha256` recomputes from its rows, its totals recount, and its `signature` verifies.
    - **(b) C is certified.** Every entry of `C.claimedProfiles` has `certified: true`.
    - **(c) The same image.** `C.host.build.kind` and `P.host.build.kind` are both `image-digest`, and the two `id`s are byte-equal. `commit` and `artifact-sha256` do not qualify: a commit does not name the bytes that ran, and two builds of one commit need not be the same artifact.
    - **(d) The row passed there.** C carries *r* as `executed-pass`, with a detail that does not begin `partial-witness:`.
    - **(e) Attributable to P's operator.** `C.signature.keyId` names a key in **P's** captured `discovery.document.signingKeys[]` with `use: "certification-bundle"`, and C's signature verifies under that key. An unpublished or throwaway key attests integrity only (conformance.md §"Bundle v3") and is refused. Unresolved question 1 records the alternative.
    - **(f) The same instrument, close in time.** `C.suite.version` and `C.suite.stampSha256` equal P's, and `|C.generatedAt − P.generatedAt|` ≤ 7 days (Unresolved question 2).
    - **(g) The same configuration as far as discovery shows.** C's and P's captured discovery documents are equal under JCS after two normalisations and nothing else. First, both documents' origins (from `C.discovery.url` and `P.discovery.url`) are replaced with one placeholder in every string value, which is the `withoutOrigins` rule `conformance/src/lib/host-public-origin.ts` already applies to a host whose URLs follow the request origin. Second, the members named in *r*'s `substitutable` list are removed from both. For `oidc-test-issuer` that is the `issuers` array of the `oidc` lane only. The lane's `revocation`, `revocationWindowSeconds` and `minimumAssurance`, the other lanes, `signingKeys[]` and everything else must match. That is what makes the companion's `exp-only 3600` the same claim production makes.
    - **(h) C declares itself.** `C.host.deployment` is `"colocated-companion"` (§E.14).

11. **The served build is on the served surface.** A bundle that records any `witnessed-colocated` row MUST capture a discovery document whose `implementation.build` (§D) is present and equal to `P.host.build`. That binds P's image digest to what the served front says it runs, at the moment of the cut, inside the signed `discovery.sha256`. Anyone can re-fetch it later, and a flip checks it live under GOVERNANCE's existing rule. §C.10(g) then forces C's `implementation.build` to be equal too.

### §D. The served surface names its build

12. `implementation` (capabilities.md §3.1; `schemas/v2/capabilities.schema.json`) gains optional `build: { "kind": "image-digest" | "commit" | "artifact-sha256", "id": string }`, the same closed shape as the bundle's `host.build`. Like the rest of `implementation` it is self-reported and informational: a client SHOULD NOT change behaviour because of it or authorize from it. A host MUST NOT advertise a `build` other than the one serving the response.

13. **Residual trust, named.** A container cannot contain its own image digest, because the digest is computed over the image. A host learns it from its deployment, for example a digest the deploy pipeline resolves from the registry and injects as configuration. So `implementation.build` is an operator's claim made on the served surface. It is **not** remote attestation. What it buys is a claim that is public, captured in the signed bundle, re-fetchable at any time, and forced equal across P and C by §C.10(g). An operator willing to misconfigure both can still lie. Binding the digest cryptographically (SLSA provenance, a platform attestation) is out of scope and is register **G6**.

### §E. A companion counts only for its anchor rows

14. `host` gains optional `deployment`, a closed enum. Its only member today is `"colocated-companion"`, and absence means the bundle measures the served host. The CLI sets it under `--as-colocated-companion`. It enters the `witnessSha256` preimage **only when present**, as `host.relaxations` does (`{ "rows", "relaxations"?, "deployment"? }`). A signed bundle cannot lose the marker without failing verification, and every existing bundle digests byte-identically.

15. **`check-accepted-predicate.mjs` rule 4.**
    - A bundle with `host.deployment: "colocated-companion"` supplies a witness **only** for rows on `harness-trust-anchors.json`. Its other `executed-pass` rows count toward nothing, however certified the bundle is. This closes §Motivation 3's first hole.
    - A `witnessed-colocated` row is never itself a witness. The companion's row is, under the bullet above.
    - A committed bundle carrying a `witnessed-colocated` row whose cited companion is **not also committed** in `evidence/v2-host-bundles/`, or fails any §C condition when re-checked by the gate, supplies **no** witness for any row. It is treated like an uncertified bundle, and the gate names the dangling citation.

### §F. Proposed normative prose (lands at `Active`; not edited by this filing)

Draft RFCs propose and implementation lands at `Active`. That is this corpus's convention: RFC 0210 held its spec text, schema member and error row back to `Active` for the same reason, and `check-rfc-status-coherence.mjs` rule 7 refuses a scenario citing a `Draft` RFC. So no spec document is edited here.

**`spec/v2/core/conformance.md` §"Whose fact is the reason?"**, appended:

> One exception, and only one. A requirement listed in `spec/v2/harness-trust-anchors.json` needs a precondition that a host serving production traffic cannot safely meet: trusting key material the suite holds. When that anchor alone is unmet, the row MUST be `blocked` with the detail prefix `harness-trust-anchor:<anchor> —`. The suite MAY then record it `witnessed-colocated`, citing a certified companion bundle of the same image digest (§"Bundle v3"). A `witnessed-colocated` row does not deny certification and is not an execution witness. No other row, and no other reason, is eligible.

**§"Bundle v3"**, two table rows (`host.deployment`, `results.totals.witnessedColocated`) and one paragraph stating §B.6–§B.9, §C.10–§C.11 and §E.14 in normative form. The estimate is about 260 words against a core headroom of 1,254 (`check-core-budget`: 28,746 / 30,000), so no family needs homing.

**`GOVERNANCE.md` "Deployed, not merged"**, a new bullet after the seam-precondition bullet:

> - **A harness trust anchor is a precondition in the same sense, and it is witnessed on a colocated companion of the deployed image, never on the deployed instance.** A requirement whose observation needs the host to trust key material the suite holds (`spec/v2/harness-trust-anchors.json`) cannot be witnessed on a production instance without making that instance accept credentials a test runner can mint. A companion booted from the deployed image digest, trusting the suite's anchor and nothing else differently, measures the same verifier code production runs. It satisfies this section for the listed rows **only**. It never satisfies it for a row whose path runs through the served front (discovery through the CDN, a rewrite, a protected-resource document, a `401` challenge as the public origin returns it), because the companion does not serve that front. A companion MUST NOT be reachable from the public internet, and MUST NOT be given production data stores or production credentials other than the bundle-signing key: an instance that trusts a runner-held key is an authentication bypass for whatever it can reach. A bundle citing a companion names it by `witnessSha256`, and the companion names itself `host.deployment: "colocated-companion"`.

### §G. Examples

**Positive: the production row.** Illustrative values. P was cut against `https://app.openwop.dev` without `OPENWOP_TEST_OIDC_ISSUER_URL` and with `--colocated-companion companion.json`:

```json
{
  "id": "openwop.requirement.0210.exp-only-lifetime-bound",
  "scenario": "v2-lane-exp-only-bound.test.ts",
  "result": "witnessed-colocated",
  "assertions": 0,
  "detail": "witnessed-colocated: oidc-test-issuer — companion witnessSha256 3f1c…e09a; harness-trust-anchor:oidc-test-issuer — OPENWOP_TEST_OIDC_ISSUER_URL is not set …",
  "evidence": {
    "colocated": {
      "companionWitnessSha256": "3f1c…e09a",
      "companionBuild": { "kind": "image-digest", "id": "sha256:547c729d…" },
      "companionSigningKeyId": "openwop-app-bundle-3",
      "companionSuiteVersion": "2.41.0",
      "companionDiscoverySha256": "9b0d…41c2"
    }
  }
}
```

P's `host.build` is `{ "kind": "image-digest", "id": "sha256:547c729d…" }`, and its captured discovery carries `implementation.build` with the same value. With every other row `executed-pass`, `inapplicable` or `skipped`, P certifies, and its `0200.prm-served` row now counts toward RFC 0200.

**Negative (each refused by `--certify` and by `--verify`):**

| Case | Refused because |
| --- | --- |
| `openwop.requirement.0200.prm-served` rewritten from `blocked` | not on the list (§B.6) |
| `0210.exp-only-lifetime-bound` `blocked` with "lane oidc advertises a 90s window …" | not the anchor reason (§A.4) |
| today's committed companion cited as it stands | `host.build.kind` is `commit` (§C.10(c)); key `openwop-app-colocated-companion-20260926025953` is not in production's `signingKeys[]` (§C.10(e)); no `host.deployment` (§C.10(h)) |
| a companion on suite 2.39.5 cited by a production cut on 2.41.0 | different suite version (§C.10(f)) |
| a companion advertising `exp-only` with a 300 s window while production advertises 3600 s | discovery not equivalent (§C.10(g)) |
| a companion with `claimedProfiles[].certified: false` | §C.10(b) |
| production row `executed-fail`, companion `executed-pass` | only `blocked` rows are rewritten (§B.7) |

## Compatibility

**Classification: `additive`**, under `spec/v2/core/overview.md` §0 ("a registry-backed enum … grows by adding a row … adding a member is additive in v2.x") and `COMPATIBILITY.md` §4 (a new normative requirement on a previously undefined behaviour). Bundle v3 has absorbed two optional additions without a version bump: row `evidence` (2.34.0, RFC 0158) and `host.relaxations` (2.35.0, RFC 0173). Both enter the preimage only when present, and that is the pattern followed here.

- **Every existing bundle stays valid and digests byte-identically.** None carries the new result, `witnessedColocated`, `evidence.colocated` or `host.deployment`. The preimage changes only when `deployment` is present.
- **Older verifiers fail closed.** A verifier on a suite that predates `Active` rejects a bundle carrying `witnessed-colocated` at schema validation. It cannot misread the row as a pass. That is the safe direction, and it is the "additive for producers, breaking for strict consumers" hazard RFC 0171 G6 records, with the usual mitigation: consumers pin `@openwop/spec-artifacts`.
- **No host obligation changes.** `implementation.build` is optional. A host that never cites a companion is untouched. No `MUST` is relaxed for any host: the `blocked` rule still denies certification for every row and reason outside §A.
- **What does tighten is corpus-side.** §E.15 narrows what `check-accepted-predicate` counts from a bundle marked as a companion. No committed bundle carries the marker. The one committed companion is unmarked and would be re-cut at `Active` (register **G1**). Measured: with it removed, the predicate stays green for all 42 Accepted v2-era RFCs, so no acceptance moves.
- **The `witness` class vocabulary is untouched.** `witnessed-colocated` is a bundle disposition, not a witness class. The anchor rows stay `witnessable-gated`.

## Conformance

**Existing coverage.** `certification-bundle-v3.test.ts` (lib) covers the verifier's recount, signature and `blocked-certified` refusals. `v2-bundle-signature-attributable` and `v2-bundle-witness-preimage` (coherence) pin attribution and the preimage. Neither knows the new disposition.

**Lands when `Active`** (nothing lands with this filing, and no scenario may cite a `Draft` RFC):

- New `conformance/src/coherence/v2-colocated-witness.test.ts` (corpus gate; never reaches a host bundle). It uses fixture pairs P/C built by the test from a throwaway key, driving the verifier and the `--certify` rewrite one condition at a time. Each negative is run a second time with only that condition repaired, and there it MUST pass, so no refusal is passing for another reason.
- New `scripts/check-harness-trust-anchors.mjs`, driven red once per §A.3 clause in a throwaway corpus copy by the same coherence test.
- `v2-lane-exp-only-bound.test.ts` and `v2-oidc-id-token-audience.test.ts`: the "not set" `blocked` detail gains the §A.4 prefix. No assertion changes.
- Suite minor bump. The three-way version pin moves together.

No requirement id enters `floorScenarios` or a profile predicate.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.3 the anchor list is closed and exact (`openwop.requirement.0216.anchor-list-closed`) | `check-harness-trust-anchors.mjs` exits 1 on a wildcard id, an anchor outside the enum, an entry whose RFC has no rows table, an entry whose scenario does not read the anchor variable, a floor scenario, and a list/table mismatch, each named (planned `v2-colocated-witness.test.ts`) | the corpus gate, unaided | witnessable — unaided (corpus), planned: six sabotages, each repaired singly to prove the others did not cause the refusal |
| §B.6 / §A.4 only a listed row, blocked for the anchor reason, is rewritten (`openwop.requirement.0216.not-on-anchor-list`) | `--certify` leaves `0200.prm-served` `blocked` with a valid companion cited, leaves a listed row `blocked` whose detail lacks the prefix, and `--verify` rejects a hand-written `witnessed-colocated` on an unlisted id | the suite, unaided, on fixtures | witnessable — unaided (corpus), planned |
| §B.7 only a `blocked` row is rewritten (`openwop.requirement.0216.fail-not-rewritten`) | a production `executed-fail` on a listed row stays `executed-fail` with a qualifying companion cited | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §B.8 not an execution witness (`openwop.requirement.0216.not-a-witness`) | `witnessCount` and `assertionCount` of P are equal with and without the rewrite; the row appears in `detail.nonPass[]` | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §C.10(b) the companion must be certified (`openwop.requirement.0216.companion-certified`) | a companion with one `blocked` row (hence uncertified) is refused by name | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §C.10(c) the same image digest (`openwop.requirement.0216.companion-build-equal`) | refused when either build is `commit`, and when both are `image-digest` with one byte differing | the suite, on fixtures | witnessable — unaided (corpus), planned. Sabotage: compare `id` only and ignore `kind`, and the `commit` case passes |
| §C.10(a)/(d) the companion verifies and the row passed there (`openwop.requirement.0216.companion-row-passed`) | refused on a companion whose `witnessSha256` does not recompute, and on one whose row is `executed-pass` with a `partial-witness:` detail | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §C.10(e) signed under a key production publishes (`openwop.requirement.0216.companion-attributable`) | refused when `C.signature.keyId` is absent from P's captured `signingKeys[]`, even though C verifies under its own discovery | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §C.10(f)/(g) same suite, within 7 days, equivalent discovery (`openwop.requirement.0216.companion-equivalent`) | refused on a suite-version mismatch, an 8-day gap, a differing `revocationWindowSeconds`, and a differing non-`oidc` lane; **accepted** when only the `oidc` issuers and the origin differ | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §C.11 / §D.12 the served build matches (`openwop.requirement.0216.served-build-matches`) | `--certify` refuses to record the disposition when the captured discovery lacks `implementation.build` or disagrees with `host.build` | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §D.12 a host advertises only the build serving the response | a host's `implementation.build` differs from the deployed revision's digest | — | unwitnessable — the suite has no independent view of which image a remote host runs; only the operator's platform does. That is why §D.13 names the residual trust instead of claiming a witness, and why register G6 exists |
| §E.14 the marker cannot be stripped (`openwop.requirement.0216.deployment-in-preimage`) | removing `host.deployment` from a signed companion fails `--verify` with `witness-digest`; a bundle without it digests as before | the suite, on fixtures | witnessable — unaided (corpus), planned |
| §E.15 a companion's non-anchor rows count for nothing, and a dangling citation voids the bundle (`openwop.requirement.0216.predicate-treatment`) | `check-accepted-predicate.mjs` does not count a marked companion's `0200.prm-served`; it counts no row of a production bundle whose cited companion is not committed | the corpus gate, unaided | witnessable — unaided (corpus), planned: fixture evidence directory in a throwaway copy |
| §F (GOVERNANCE) a companion is not internet-reachable and holds no production data | — | — | unwitnessable — an operator's network and data topology are not observable from the bundle or from the suite, and a companion that was exposed leaves no trace in its rows. Stated as an operator obligation, as GOVERNANCE states the seam rule, and carried as risk R3 |

## Alternatives considered

1. **Do nothing.** openwop-app's production bundle stays uncertified the moment it advertises its `oidc` lane. Every public-surface row it measures stays unusable, and the only route to a certified production bundle is to trust a test issuer in production. A certification rule that pays for an authentication bypass is worse than one exception bounded by a closed list. Doing nothing also leaves both holes in §Motivation 3 open: the committed companion's public-surface rows are countable today.
2. **Record the anchor rows `inapplicable` in production.** This is false. The rows bind any host advertising the lane, and conformance.md reserves `inapplicable` for a requirement that "does not bind that host". It would also let the companion's evidence go uncited.
3. **Operator opt-out (`skipped`).** An opt-out means the host does not advertise the surface, and the verifier refuses `opted-out-but-advertised`. The host does advertise the lane.
4. **Scope `blocked` to claimed profiles.** In other words, a `blocked` row outside every claimed profile's floor would not deny certification. That is general where this RFC is narrow: every suite-side failure on a non-floor row would stop mattering, which is exactly the conflation RFC 0148 removed. The closed list is what keeps this an exception.
5. **Let production trust a test issuer behind a guard** (an IP allowlist, a short-lived key, a header). ADR 0745 D4 chose "no escape hatch" deliberately. Any guard is a new way into an internet-reachable service, and the corpus must not reward building one.
6. **Use the production IdP's real test users instead of a synthetic issuer.** Partly possible for `0200.id-token-aud`: a second real audience could mint the foreign token. It is impossible for the four 0210 rows, which need a correctly signed token with a back-dated or forward-dated `iat`, and no real IdP mints those on request. A per-row mix would leave the scenario rows `blocked` anyway.
7. **Merge the two runs into one bundle.** Row provenance disappears: a reader could not tell which rows the served front witnessed. The per-row disposition and citation keep that visible, and §E.15 depends on it.
8. **`bundleVersion: "4"`.** It would be cleaner on paper, but the change is additive, and v3's two precedents (row `evidence`, `relaxations`) landed as optional members without a bump. A version bump would also un-upgrade every tool for no gain in safety, since older verifiers already fail closed.

## Unresolved questions

1. **Attribution: the production key (§C.10(e)), or incorporation by digest?** Option A (this draft) requires the companion to be signed under a key the production host publishes. That needs the bundle-signing private key on the colocated rig, which is the operator's own machine, and the key cannot authenticate anything. Option B accepts any companion signature for integrity and relies on P's signature: P's signed `witnessSha256` covers the row's `evidence.colocated.companionWitnessSha256`, so production's operator vouches for exactly those companion bytes. B is cheaper, and arguably equivalent, because all bundle evidence here is operator self-evidence (`evidenceTier: self`). A is stricter and keeps the existing rule that an unpublished key attests integrity only, without an exception. Register **G2**.
2. **Staleness: is 7 days right?** Alternatives: the same UTC day; or "C cut after the deployment P names", which needs a deploy timestamp nothing serves. The same-suite rule already pins the instrument, and the digest rule pins the code, so the window mostly bounds configuration drift (question 4).
3. **Should `implementation.build` be REQUIRED of any host that cites a companion, or of every host?** This draft binds it only to a bundle recording the disposition (§C.11). Making it universal would give every GOVERNANCE live check a machine-readable target, but it is a new obligation on every host.
4. **Configuration drift outside discovery.** Two instances of one image can differ by an environment flag that discovery never shows, for example one that disables the lifetime comparison. §C.10(g) catches every difference discovery exposes, and nothing else. Options: accept it as residual operator trust (this draft, risk R2); or require the companion to publish a declared configuration diff whose only permitted entry is the anchor. The diff would still be self-declared. Register **G3**.
5. **Should the corpus say normatively that a production host SHOULD NOT trust a harness issuer?** openwop-app enforces it by ADR. The premise of this RFC is that doing so is correct. Stating it in `security-defaults.md` would make the rationale normative, and would give "a host that trusts a test issuer in production" a name the invariant catalogue could carry.
6. **The committed companion.** It is unmarked, `commit`-kind, and throwaway-signed, and RFC 0213's `Updated` field cites it as a second witness for non-anchor rows. At `Active`, should it be re-cut to §C's shape, or relabelled in the matrix and left as historical? §E.15 would count nothing from an unmarked bundle differently than today, so re-cutting is the only way to close the hole for this file. Register **G1**.
7. **Given openwop#1581, keep `witnessed-colocated` or only the companion marker?** If #1581's `inapplicable` disposition lands, is the production-side `witnessed-colocated` disposition still worth its schema surface, or should this RFC shrink to the signed companion marker plus the predicate rule that a companion's non-anchor rows count for nothing (§3)? The marker is needed either way.

## Implementation notes (non-normative)

- **openwop-app.** The deploy pipeline resolves the image digest it deploys and injects it (for example `OPENWOP_BUILD_DIGEST`). `routes/discovery.ts` serves it as `implementation.build`, and the companion boot receives the same value. The companion runbook (`--as-colocated-companion`, production signing key, loopback-only binding, memory storage, throwaway secrets other than the bundle key) replaces the 2026-09-25 recipe. A production deploy is needed before the first production cut can cite a companion, and that deploy waits on the steward's `gcloud` re-auth (register **G4**).
- **Order at `Active`:** schemas by hand → `harness-trust-anchors.json` + schema → `generate-spec-artifacts.mjs --write` → suite (`requirement-ledger.ts` `CERTIFIABLE`, `certification-bundle-v3.ts` result type, totals, preimage `deployment`, `cli.ts` rewrite + `--colocated-companion` + `--as-colocated-companion`, verifier) → the two scenarios' prefix → coherence test → `check-accepted-predicate.mjs` §E.15 → `generate-requirement-registry.mjs --write` → `generate-protocol-status.mjs --write`.
- **Sabotages owed before `Active`** (the coherence test runs them; record each in this section): compare `id` without `kind` (§C.10(c)); skip the key-publication lookup (§C.10(e)); normalise more than the substitutable member (§C.10(g)); rewrite `executed-fail` rows (§B.7); count the disposition into `witnessCount` (§B.8); omit `deployment` from the preimage (§E.14); let the predicate count a marked companion's `prm-served` (§E.15).
- **Expected effect, stated as expectation rather than measurement:** openwop-app's next production cut, after a deploy that serves `implementation.build` and advertises the `oidc` lane, would record seven `witnessed-colocated` rows, certify, and make its four RFC 0200 public-surface rows the first served-front witness for them.

## Acceptance criteria

- [ ] The public comment window closes (2026-10-03) with no unresolved objection, and the RFC moves `Draft → Active` without a waiver, or under an override recorded as such.
- [ ] `conformance.md` and `GOVERNANCE.md` carry §F's prose. `check-core-budget` stays green.
- [ ] `certification-bundle.schema.json`, `capabilities.schema.json`, `harness-trust-anchors.json` + schema land, and `generate-spec-artifacts --check` passes.
- [ ] `check-harness-trust-anchors.mjs` is in `openwop:check` and green on the seven-row list.
- [ ] `v2-colocated-witness.test.ts` mints every `openwop.requirement.0216.*` id in §Falsifiability, with each sabotage in §Implementation notes run and recorded, and `evidence/corpus-ledger.json` carries each `executed-pass`.
- [ ] `check-accepted-predicate.mjs` implements §E.15, and is green on the committed evidence.
- [ ] The committed companion is re-cut to §C's shape, or relabelled (Unresolved question 6).
- [ ] A certified production bundle from a deployed host records at least one `witnessed-colocated` row whose companion is committed beside it, and `--verify` accepts the pair. This is the evidence that the mechanism works end to end on a served host. The corpus rows above are its unit tests.
- [ ] CHANGELOG entry.

## References

- `spec/v2/core/conformance.md` §"Whose fact is the reason?", §"Bundle v3", §"Canonical JSON"; RFC 0168 §E.1 (a blocked row denies certification); RFC 0148 §A (the certifiable dispositions).
- `GOVERNANCE.md` §"Acceptance evidence tiers" → "Deployed, not merged", and its seam-precondition bullet (the precedent §Motivation 4 follows).
- `conformance/src/cli.ts` (the `certified` term), `conformance/src/lib/requirement-ledger.ts` (`CERTIFIABLE`), `conformance/src/lib/certification-bundle-v3.ts` (`witnessDigest`, `verifyBundleV3`), `conformance/src/lib/host-public-origin.ts` (`withoutOrigins`), `scripts/check-accepted-predicate.mjs` (the `uncertified` branch, rule 4).
- `evidence/v2-host-bundles/openwop-app-colocated-companion.json`; `INTEROP-MATRIX.md` (the openwop-app row and its companion note).
- RFC 0200 (`id-token-aud`, the public-surface rows), RFC 0210 §B (the four lifetime rows), RFC 0213 (which cites the companion), RFC 0158 and RFC 0173 (optional-when-present preimage precedents), RFC 0171 G6 (strict-consumer hazard), RFC 0147 §A.6 (the comment window), RFC 0156 §B.
- openwop-app ADR 0745 D4 (`host/oidcTrustGuard.ts`): a Cloud Run service refuses to boot trusting a harness issuer.
