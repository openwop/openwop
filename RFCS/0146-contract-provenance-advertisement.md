# RFC 0146: `contractProvenance` — which corpus revision a host implements against

| Field             | Value                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0146                                                                                                                                      |
| **Title**         | `contractProvenance` — which corpus revision a host implements against                                                                    |
| **Status**        | `Accepted`                                                                                                                                  |
| **Author(s)**     | David Tufts (@davidscotttufts), from a drift found by the openwop-app reference host                                                       |
| **Created**       | 2026-08-11                                                                                                                                |
| **Updated**       | 2026-08-13                                                                                                                                |
| **Affects**       | `schemas/capabilities.schema.json` (root), `spec/v1/capabilities.md` §"Contract provenance"                                               |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — one optional root property on a server-emitted document; nothing becomes required or changes type |
| **Supersedes**    | —                                                                                                                                         |
| **Superseded by** | —                                                                                                                                         |

> **Status note.** `Accepted` 2026-08-13 — **both halves landed and were witnessed together on the wire.** Consumer half: `contract-provenance.test.ts` leg C (2026-08-11) reads an advertised revision, compares it against the suite's own stamp, and reports drift. Advertising half: the **in-memory reference host** (openwop-examples#13) derives `contractProvenance` from its installed package's `CORPUS-STAMP.json`, which is the derived-not-asserted form G2 recommends.
>
> **The witness exercised the interesting branch, not the trivial one.** The host advertised `1.73.0` / `b4b867e3` against a suite at `1.97.0` / `96971233` — a genuine revision difference — and the consumer leg **reported it without failing**, which is requirement 3 rather than timidity: additive means an older host is *conformant*.
>
> **Evidence tier stated plainly: this is a tier-1 steward reference host.** This RFC's gate asks for "a host advertising it truthfully" and sets no tier bar, so the gate is met as written — but that is a narrower claim than adoption, and nothing here should be read as the latter. G3 originally anticipated openwop-app as the advertiser; a second advertiser remains welcome and is not required by this RFC's text.
>
> Closes the detection half of RFC 0145 G2.

## Summary

A host that hand-copies corpus schemas can validate against a contract that has moved. This happened: the reference host's vendored `capabilities.schema.json` carried **81 properties where the corpus had 88** — so it had been validating its own discovery document against a contract that predated the very declaration it was checking. It was green, and wrong.

Nothing on the wire distinguishes that host from a current one. `contractProvenance` is the host's statement of **which corpus revision its contract handling corresponds to**, so a consumer — a peer host, a client, the conformance suite — can notice the gap *before* it costs anything.

## Motivation

### Nothing already on the wire answers this — checked, not assumed

The obvious objection is that discovery already carries versions. It does, and none of them answer the question:

| Field | What it says | Why it doesn't answer |
|---|---|---|
| `protocolVersion` | `"1.0"` | Constant across the **entire v1 line**. The 81-property host and the 88-property host both report `"1.0"` — the drift happened *inside* this value. |
| `schemaVersions` | `{ "prd.create": 2 }` | Per **envelope type**, not the contract set. Says nothing about which capability families or facets the host knows. |
| `supportedEnvelopes`, `limits` | envelope names, numeric caps | Unrelated. |

This is the test RFC 0145 applied to `schemaEndpoint` and failed it: *a discovery key that restates a computable value earns nothing.* `contractProvenance` passes both halves — **not computable** from anything on the wire, and it gates a real difference in what a consumer may conclude.

### Why the packaging fix was not enough

RFC 0145 G2 has already been narrowed twice: the published tarball pins the contract schemas at stable paths, `schemas/CORPUS-STAMP.json` carries `{suiteVersion, corpusCommit}` **inside** the directory that gets copied, and `conformance/README.md` says plainly: depend on the package, don't hand-copy.

That makes staleness **avoidable and self-detectable**. It does not make it **detected**. Nothing forces the comparison, and *the corpus cannot see a host's local files.* The only party positioned to notice is a **consumer of the host**, and the only thing it can see is what the host says.

So the fix has to be a claim on the wire. That is the whole design.

## Proposal

One optional root property on the discovery document:

```jsonc
{
  "protocolVersion": "1.0",
  "contractProvenance": {
    "suiteVersion": "1.72.0",
    "corpusCommit": "93d4692eb1e28244b860da6ddcb6521b57a712b3"
  }
}
```

Both members are OPTIONAL; a host that knows only one advertises only that one. The shape deliberately mirrors `schemas/CORPUS-STAMP.json`, so a host depending on the published package can read its own stamp and echo it without inventing anything.

### Normative requirements

1. `contractProvenance` is **OPTIONAL**. **Absent ⇒ unspecified provenance** — not "current", not "stale". A host MUST NOT be treated as non-conformant for omitting it, and a consumer MUST NOT infer a version from its absence.
2. A host that advertises it MUST report the corpus revision its contract handling **actually corresponds to** — the copy it validates and serves against. Advertising a revision it does not implement is a false statement, exactly as under RFC 0145 requirement 3.
3. **It is ADVISORY. A consumer MUST NOT reject a request, refuse interop, or fail a run solely because `contractProvenance` differs from its own.** Within v1.x, corpus revisions are additive (`COMPATIBILITY.md` §2.1), so a host on an older revision is **conformant** — the field detects *drift*, it does not make drift an error. A consumer MAY warn, log, or surface the difference.
4. `suiteVersion` is a published `@openwop/openwop-conformance` version; `corpusCommit` is a full 40-character commit SHA of this repository. A host MUST NOT put anything else in these fields — a vendor build identifier belongs in `implementation`, which already exists for it.

### What this does NOT do

- **It is not an integrity check.** `corpusCommit` says *which* contract, never *whether the copy was modified*. A host that hand-edits a vendored schema still reports a clean provenance. A content digest is a different artifact answering a different question, and is not proposed here.
- **It adds no obligation to be current.** Requirement 3 exists to prevent this field becoming a back-door "upgrade or be rejected" lever inside a version line where older is legal.
- **It does not detect a host that simply doesn't advertise.** Requirement 1's honest default is silence, and silence is indistinguishable from currency. That is the residual, recorded as G1 rather than argued away.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1. One optional property on the **server-emitted** discovery document, whose root is OPEN (`additionalProperties: true`) per RFC 0094 / §"Schema closure" — so declaring it is strictly permissive and invalidates nothing. No existing field changes meaning or type; no error code changes; a host that never advertises it stays conformant with today's semantics.

Note the closure direction, because it is the inverse of RFC 0136's `format`: that property rides a **client-submitted closed** shape, which is why an enum there would have been a hard `POST` failure. This one rides a **server-emitted open** shape, where a consumer that does not recognise the key ignores it.

## Conformance

`contract-provenance.test.ts` — always-on corpus legs plus one behavioral leg:

- the root declares `contractProvenance` with optional `suiteVersion` / `corpusCommit`, and it is **not** required;
- `corpusCommit` is constrained to a 40-hex-character SHA, and a short SHA or a vendor build string does **not** validate — requirement 4, which is what keeps the field from silently becoming a free-text version box;
- a document omitting it validates — requirement 1;
- **behavioral, gated on the host advertising it:** the advertised `suiteVersion`, when present, is a version the registry has published — a host cannot claim a corpus revision that does not exist.

**Deliberately not built:** a leg asserting the advertised revision *matches what the host actually validates with* (requirement 2). Nothing observable from outside distinguishes a host implementing corpus X from one claiming X — that is the same self-report limit as RFC 0145 requirement 3, and asserting it would be theatre. Carried as G2.

## Alternatives considered

1. **Reuse `protocolVersion`.** Rejected — it is `"1.0"` for the whole v1 line, and the drift this closes happened *inside* that value. Widening it to carry corpus revisions would change the meaning of an existing required field, which `COMPATIBILITY.md` §2.2 forbids outright.
2. **Reuse `schemaVersions`.** Rejected — it is keyed by envelope type and answers "which version of *this payload*", not "which contract set do you know". Overloading it would make one field answer two unrelated questions, and the corpus already has a worked example of what that costs (`§host.http` advertising `httpClient`).
3. **A content digest of the host's vendored schemas.** Rejected for now — it answers a *different* question (tamper detection, not identity), requires hosts to hash files they may not have, and would fail for the common and legitimate case of a host that depends on the package rather than vendoring. Noted in §"What this does NOT do" so nobody mistakes this field for it.
4. **Make the conformance suite detect drift by validation alone.** Rejected because it cannot work: v1.x changes are additive, so a document written against an older contract still validates against the newer schema. Validation is exactly the instrument that cannot see this, which is why the 81-vs-88 host was green.
5. **Do nothing; the packaging fix is enough.** Rejected, and this is the one worth stating: it makes staleness *avoidable*, and avoidable is not detected. A host that keeps hand-copying gets no signal, and the corpus cannot see its files. Something has to cross the wire.

## Unresolved questions

1. Whether the conformance suite should **report** a provenance older than its own on every run, or only when a leg fails. Reporting always is more honest but adds noise to green runs; reporting only on failure risks the information arriving when it is least useful. Left to the first consumer implementation to inform.
2. Whether `corpusCommit` alone should be sufficient without `suiteVersion`. Today both are optional and independent; if adopters consistently carry only one, the other may warrant deprecation rather than two fields that drift apart.

## Open spec gaps

| ID | Gap |
|---|---|
| G1 | **Silence is indistinguishable from currency.** Requirement 1 makes absence mean *unspecified*, which is the honest default — but it also means a stale host that simply never advertises is exactly as invisible as it was before this RFC. The field helps only hosts willing to state their position. No mechanism here changes that, and pressuring hosts to advertise would convert an optional field into a de-facto requirement inside v1.x. |
| G2 | **Requirement 2 is a self-report and cannot be witnessed.** Nothing observable from outside distinguishes a host implementing corpus X from one merely claiming X. Same limit as RFC 0145 requirement 3 — where the reference host closed it *by construction*, deriving advert and event from one source. The analogous fix here is a host deriving `contractProvenance` from the installed package's `CORPUS-STAMP.json` rather than from a hand-written constant, which makes the claim structurally true instead of merely asserted. Recorded as the recommended implementation, not as a MUST. **See the deployment caveat below — the recommendation carries a packaging assumption that does not travel with it.** |
| G3 | **Adoption-gated — CONSUMER half built 2026-08-11; advertising half in flight.** The mechanism needs a host that advertises *and* a consumer that acts on a mismatch, and this row tracks both. **Consumer half: done.** `contract-provenance.test.ts` leg C reads a host's advertised revision, compares it against the suite's own `schemas/CORPUS-STAMP.json`, and **reports** the drift. It **never fails on a difference** — requirement 3, not timidity: additive means a host on an older corpus is *conformant*, and reddening it would convert an advisory disclosure into an upgrade mandate inside a version line where being behind is legal. What it *does* assert is that an advertised object carries at least one of the two members, because an object conveying neither is indistinguishable from silence while looking like an answer. Verified in the **published** layout across four host postures — same revision, drifted, silent (inapplicable), and `{}` (fails) — because the suite's stamp exists only in the tarball, so a repo-layout run has nothing to compare and proves nothing. **Advertising half: DONE 2026-08-13** — landed on the **in-memory reference host** (openwop-examples#13), not openwop-app as this row originally anticipated, and the row is corrected rather than left asserting the older expectation. It derives both values from the installed package's `CORPUS-STAMP.json` rather than a constant, so the claim is structurally true instead of merely asserted. Witnessed end-to-end against the published-layout suite: host `1.73.0`/`b4b867e3` vs suite `1.97.0`/`96971233` — a **real** revision difference, reported and not failed. **What remains open is adoption, not mechanism:** one advertiser exists and it is the steward's own, so this demonstrates the mechanism works rather than that the ecosystem uses it. |

### Deployment caveat on G2 — derive at BUILD time, and assert at DEPLOY time

Non-normative. G2 recommends deriving `contractProvenance` from the installed `@openwop/openwop-conformance` package rather than from a constant. **That recommendation carries an unstated packaging assumption: that the package is present in the environment where the derivation runs.** In a production image it very often is not.

**This shipped.** `openwop-app` (tier-1) implemented the derivation on 2026-08-11, deployed it, and **served no `contractProvenance` at all** — because the package is a `devDependency` and its Dockerfile runs `npm ci --omit=dev`, so the runtime `require.resolve` threw in the final stage. Correct in source, correct in dev, inert in production. The host is named because an anonymised version of this warning reads as a hypothesis, and a hypothesis is what G2 already is.

**Why nobody noticed, and why nobody could have.** Requirement 1 makes absence *legitimate* — so an honest omission and a broken derivation are **the same bytes on the wire**. G1 records that silence is indistinguishable from currency, but frames silence as a *choice*; this is the other case, where silence is a *failure*, and no consumer can tell them apart. An optional field whose absence is honest cannot distinguish **didn't** from **couldn't**.

**The reference host is not wrong and this does not ask it to change.** Module-load derivation from the installed package (`openwop-examples` `examples/hosts/in-memory/src/server.ts`, `#13`) is correct for a host that ships with its dev dependencies. The hazard is the recommendation travelling without its assumption, not the implementation.

So the guidance completes as two halves:

1. **Derive at build time and stamp the value into the image**, from the same installed package, so the claim survives a runtime stage that strips dev dependencies. Derived-not-asserted is preserved; only the moment of derivation moves.
2. **Assert at deploy time that it survived.** The wire can never self-report this failure, so the check belongs where the distinction *is* knowable — the deployer knows which suite it built against, so `advertised contractProvenance.suiteVersion == the image's own stamp` is checkable there and nowhere else. Absent-when-a-stamp-exists is then a hard failure with an unambiguous diagnosis; absent-with-no-stamp stays legitimately silent.

A host that cannot derive honestly **MUST** still omit the field rather than reconstruct one — inventing a `corpusCommit` to fill the shape is the false statement requirement 2 forbids, and a partial derivation advertises only the member it actually knows (requirement 1: both members are optional).

Reported by `openwop-app` while implementing this RFC's advertising half; the defect was found only because someone went to build a field that already existed.

## References

- RFC 0145 G2 — the vendored-schema staleness this closes the detection half of; its packaging half (pinned paths, `CORPUS-STAMP.json`, guidance) landed 2026-08-10/11
- `conformance/README.md` §"Resolving the contract" — depend on the package, don't hand-copy
- `spec/v1/capabilities.md` §"Document-root layout (normative — RFC 0073)" — why this is a root property and not a wrapper key
- RFC 0144 — the declaration discipline this follows: a wire field with a normative surface behind it, declared in `capabilities.schema.json`
- openwop-app: the 81-vs-88 vendored drift (2026-08-10) that motivated it, and `33ac5d9b8` — the import-from-package fix that makes the drift structurally impossible on that host
