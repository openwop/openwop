# RFC 0180: Vendor-org registration — the procedure the registry never had

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0180                                                            |
| **Title**         | How an org gets into `spec/v2/declaration.json` `extensions`: the corpus is the sole registrar, registration takes effect on a `@openwop/spec-artifacts` release, and a shipped entry is append-only because deregistering an org retroactively converts pass-through into refusal for every log already written |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-06                                                      |
| **Updated**       | 2026-09-14 (§A.4a records the RULING: the era-2 reader rule stands. A production census put the malformed-name exposure at ONE row and the real exposure at 1273 rows under `ai.*`/`node.*`/`conversation.*` — two of which are namespaces the protocol itself owns, so passing them through would make a protocol typo indistinguishable from a vendor event.) · 2026-09-14 (§A.4a normative text WITHDRAWN. Its first two revisions asserted an era-2 reader MUST that contradicted `persistence.md` §The reader rule, `events.md` §Era-2, RFC 0176 §A.3 and the `v2-unmapped-type-refused` scenario — a registration procedure is not the seat of a reader rule. The durable-log problem it tried to solve is recorded as an open question for an RFC 0176 amendment.) · 2026-09-13 (§A.4a widened from a SHAPE test to a reserved-prefix test: a shape test still orphans era-2 rows whose types were never well formed — four segments, or an underscore — which turns a writer's past bug into permanent unreadability for every reader. Raised by the tier-1 host against its own 11 malformed durable types.) · 2026-09-13 (§A.4a added: an era-2 read tests the vendor SHAPE, not the registration, so a host re-namespacing its vendor types does not retroactively lose the runs it already wrote.) · 2026-09-06 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`.) · 2026-09-06 (filed; the registry shipped at 2.0.0 admitting exactly one reserved org and no way for a second to be added — a predicate every reader evaluates with no procedure behind it) |
| **Affects**       | `spec/v2/declaration.json` (`$comment` procedure pointer), `spec/v2/core/persistence.md` §"The codemap is data" (one pointer sentence), `RFCS/0169` §Unresolved-1 (closed: short form), suite `2.0.6 → 2.0.7` (packed content) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1): no field, MUST, error code, or existing entry changes; the entry shape and org grammar were already pinned by `declaration.schema.json` |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`spec/v2/declaration.json` `extensions` is the vendor-org registry. `persistence.md` §"The codemap is data" makes a host's read behaviour turn on it: a vendor-prefixed v1 type the codemap does not name MUST be read under its own name, where "vendor-prefixed" means the first segment is a key in that object — and "an unregistered first segment is not a vendor prefix and falls to the refusal below." The registry shipped at 2.0.0 holding one entry, `example`, `reserved: true`, never assignable to a vendor. **No procedure for adding a second entry exists anywhere in the corpus.** This RFC supplies it, and nothing else: the entry shape, the org grammar, and the reserved list are already normative in `declaration.schema.json` and are not restated here.

## Motivation

The gap is not theoretical and was found from the outside. A host operating a live v2 deployment carries 31 event types under its own org, correctly reads the refusal rule, and correctly concludes that its own types must be refused — because its org is not registered, and there is no way for it to become registered. The predicate is well defined and the procedure behind it is empty, so the only conforming behaviour is one no one wants and every affected party can see is provisional.

Three things follow, and each is a decision this RFC has to make rather than inherit:

**The registrar cannot be the host.** RFC 0169 §Unresolved-1 left the org form open and recommended "short form, registered in the declaration file"; it did not say who registers. Letting a host declare its own orgs would make the refusal predicate host-controlled — a host would make its own types pass by naming itself — which is the same defect `persistence.md` already forbids as a private mapping. The codemap is data for exactly this reason, and the registry is the codemap's admission list. It has to be one artifact every reader resolves identically.

**Registration is a release event, not a merge event.** The registry is data shipped in `@openwop/spec-artifacts`. A merged PR that no release carries is invisible to every consumer, so the effective date is the release, not the merge.

**Deregistration is a wire-breaking change and the registry is therefore append-only.** This is the consequence that is easy to miss. Removing an org does not merely stop new types from passing: it flips every already-written log carrying that org from *pass-through* to *refusal*, retroactively, on the next read. A log that was readable becomes unreadable without a byte of it changing. Nothing else in the corpus behaves that way, and it is the reason the registry needs a stated removal rule rather than an assumed one.

## Proposal

### A.1 The corpus is the sole registrar

`spec/v2/declaration.json` `extensions` is the only vendor-org registry. A host MUST NOT treat any other source — its own configuration, its discovery document, a pack manifest, an operator setting — as registering an org, and MUST NOT extend the registry at runtime. A reader that resolves a different registry than another reader decides the same log differently, which is the outcome the single-authority rule exists to prevent.

### A.2 How an org is registered

Registration is a pull request against the corpus adding one key to `extensions`. The entry MUST satisfy `declaration.schema.json` (`name` and `registered` required; `reserved` and `note` optional; key matching `extensionsKeyPattern`). In addition:

1. The key MUST NOT appear in `reservedOrgs` (`openwop`, `vendor`).
2. The key MUST NOT already be present. A registered org is never reassigned to a different party, whatever the state of the original registrant — see A.4.
3. `registered` MUST be the date the entry is merged, in `YYYY-MM-DD`.
4. `name` MUST identify the registering party well enough for a reader to attribute an unfamiliar event type to someone. A `note` SHOULD say what the org is for when the name alone does not.

The bar is **disambiguation, not endorsement.** The registry answers "whose types are these?" and nothing else: an entry is not a conformance claim, a certification, a quality signal, or a statement that the registrant's host passes anything. The steward reviews an application against A.2 and A.3 only; a registration MUST NOT be refused on the basis of the applicant's implementation, licence, or competitive position.

### A.3 Squatting

An org MUST correspond to a party that ships, or has a concrete plan to ship, event types under it. The steward MAY refuse an application that reserves a name for no declared purpose, and MAY refuse one whose key is a plausible misreading of an existing registrant. Protocol-held names (`reserved: true`) are registered by the steward alone.

### A.4 Append-only

A shipped `extensions` entry MUST NOT be removed, and its key MUST NOT be reassigned. This holds even when the registrant ceases to exist, renames itself, or asks for removal: the entry is not a property of the registrant but a statement about how every reader decodes logs already on disk, and those logs do not disappear with the company that wrote them.

An entry MAY be amended — `name`, `note`, and `reserved: true` may be updated to reflect a rename or a transfer of stewardship — because none of those change any read outcome. `registered` MUST NOT be edited after the release that carried it; it is the field a reader uses to reason about when a type became legible.

Where a registrant must be repudiated, the mechanism is a `note`, not a deletion.

### A.4a Registration does not change the era-2 reader rule

**This section legislated a rule it does not own, and the normative text is
withdrawn.** What follows is the correction and the open question it leaves.

**What the shipping rule is.** The era-2 reader rule belongs to RFC 0176 §A.3,
and is stated normatively in `spec/v2/core/persistence.md` §The reader rule and
`spec/v2/core/events.md` §Era-2 logs:

> A type the codemap does not name and that carries no reserved vendor prefix
> MUST fail the read with `event_type_unmapped` (`500`) — a run whose log the
> host cannot translate is not readable, not "tolerantly" readable.

That refusal is deliberate, not an oversight. RFC 0176's migration row
`openwop.migration.C9.3` names v1's tolerant reader — *"unknown `type` passed
through"* — as the behaviour v2 migrates AWAY from, and
`conformance/src/scenarios/v2-unmapped-type-refused.test.ts` witnesses it on
both halves: `foo.bar` (unregistered) MUST fail `500 event_type_unmapped`, and
`example.thing-happened` (registered, owned by nobody) MUST pass through.

**Registration governs the WRITER, and that is all this RFC decides.** A
producer MUST NOT emit a type under an unregistered org. Whether a READER
refuses an already-written row is RFC 0176's question, and the answer there is
unchanged by anything in this document.

**The question was asked and ANSWERED: the reader rule stands. Decided 2026-09-14.**

The cost looked large when it was estimated and small when it was measured. The
tier-1 host ran a read-only census against production
(`scripts/era2-vendor-type-census.mjs`, openwop-app #3801): **277 (tenant, type)
pairs over 50 distinct types** — 255 codemap-named, 22 vendor-branch pairs
totalling **1273 rows**, and 10 pairs flagged invalid under `events.md` §Types.

Two findings reshaped the question:

- **Nine of the ten "invalid" pairs (376 rows) were not malformed names at all.**
  They were whole serialised JSON envelopes written into the `type` column by an
  `emit` arity bug — fixed at source (openwop-app #3802) and deliberately not
  backfilled.
- **The malformed-name exposure is ONE ROW** (`host.crm.contact.triaged`). The
  durable-history argument that produced two revisions of this section, and that
  three parties spent two days reasoning about, was one row on one tenant.

The real exposure is 1273 rows under the orgs `ai.*`, `node.*` and
`conversation.*` — well formed, but unregistered. **Those stay refused**, for
three reasons, in order of force:

1. **Two of those three orgs are namespaces the PROTOCOL owns.** The codemap's
   v1 side carries 10 `node.*` rows (`node.started`, `node.completed`,
   `node.failed`, `node.suspended`, …) and 3 `conversation.*` rows. So
   `node.progress` is not a vendor event; it is a host-invented event inside the
   protocol's own namespace. Under a shape-only pass-through, `node.startd` — a
   one-character typo of a protocol event — is indistinguishable from it, and a
   protocol event silently demoted to opaque data is worse than a `500` that says
   so. **Registration is the only thing separating "a vendor event to carry" from
   "a protocol event somebody misspelled."**
2. **Relaxing it would break every certified host.** `COMPATIBILITY.md` §2.2:
   *"Existing `MUST` requirements MUST NOT be relaxed."* A host that refuses
   correctly today would become non-conformant and its certified bundle invalid.
   Keeping the rule invalidates nobody.
3. **The writer already has the remedy** and it costs nothing: register the org,
   namespace the events, and the rule never bites again. openwop-app #3800
   renamed ten of eleven types this way.

A retraction belongs here too, because it was this RFC's argument: the claim that
registration-gated refusal is incoherent *because the registry ships in
`spec-artifacts`, so a durable row's readability becomes a function of the
reader's corpus version* is **true and is not a defect**. The codemap ships in the
same package and already governs readability by release. Version-dependent
readability is the design, not a flaw discovered in it.


And it could not have been resolved from HERE in any case, for three reasons
worth recording so the next person does not repeat the attempt:

1. **The codemap is not the escape hatch.** `spec/v2/event-codemap.json`'s
   `grammar` admits exactly two kebab segments, so the malformed names cannot be
   named there even as a courtesy.
2. **"What the host could have written" is not a wire rule.** It is answerable
   only from host-local history, so two conforming readers would disagree about
   the same row — the private-mapping defect `persistence.md` already forbids.
3. **Relaxing the refusal reverses C9.3**, which is a tracked migration
   decision with two conformance scenarios behind it. Reversing it is legitimate
   only as an RFC 0176 amendment that changes `persistence.md`, `events.md` and
   both scenarios in the same PR.

**Why this section says so little now.** Its first two revisions asserted a
reader MUST — first shape-gated, then widened to a reserved-prefix test — and
both contradicted `persistence.md` §The reader rule and the scenario that
enforces it. Neither revision opened those files. A registration procedure is
not the seat of a reader rule, and the durable-log problem deserves an amendment
that argues it against C9.3 on the record, not a parenthetical in a document
nobody would think to check.


### A.5 Effective date

An entry takes effect for a consumer when a `@openwop/spec-artifacts` release carrying it is installed. A host MUST NOT emit types under an org before the release carrying it is published, and MUST NOT assume a peer resolves an org merely because the corpus PR merged. Until then the org is unregistered and the refusal at `persistence.md` §"The codemap is data" is the correct behaviour — including for the registrant's own types.

The corollary is the one hosts will actually hit: registering an org does not make previously-written types retroactively legible on a peer that has not upgraded. Version-skew here is ordinary dependency skew and is resolved by pinning, not by protocol.

## Compatibility

`additive` per `COMPATIBILITY.md` §2.1. No schema, field, `MUST`, error code, or existing registry entry changes; `declaration.schema.json` already pinned the entry shape and key pattern, and this RFC adds no property to it. The only wire-visible consequence is that orgs registered under A.2 begin to pass through where they previously fell to the refusal — which is the additive direction, and is gated on a release the consumer chooses to install (A.5).

A.4 constrains a future change rather than making one: it forecloses deregistration, which would have been breaking had anyone attempted it.

## Conformance

`spec-corpus-validity` already validates `declaration.json` against `declaration.schema.json` on every corpus change, which covers the entry shape, the key pattern, and the `reservedOrgs` exclusion mechanically. This RFC adds no scenario, because the obligations it introduces are not host behaviour:

- A.1 is a **negative-existence** claim about the host (it does not consult a second registry). It is not black-box witnessable — a host that reads a private registry which happens to agree with the corpus is indistinguishable on the wire from one that does not — and per `conformance.md` §"Witness class" it is recorded as such rather than given a scenario that would pass vacuously.
- A.2, A.3 and A.4 bind the steward and the corpus, not a host. A.4's enforcement surface is review: a PR deleting an `extensions` key is a breaking change and is caught by reading it.
- A.5 is already witnessed indirectly: `v2-unmapped-type-refused` drives a registered org (`example`) through the pass-through leg and an unregistered one through the refusal leg, so a host that ignores the registry in either direction reddens a row it already runs.

The honest statement is that this RFC is process, and its evidence is that the process was followed.

## Alternatives considered

**Host-declared orgs, in the discovery document.** Rejected in A.1: it makes the refusal predicate host-controlled and reintroduces the private mapping. It also breaks the property that two readers of the same log agree, which is the whole point of the codemap being data.

**Reverse-DNS org form (`com.myndhyve`).** RFC 0169 §Unresolved-1 left this open. Rejected: the dot is the type separator, so a reverse-DNS org makes the first segment ambiguous with the type path and forces every reader to know the org list before it can even split the string. The short form keeps `orgOf(type) = type.split('.')[0]` decidable without the registry, so an unregistered org is *identifiable* and merely not *admitted*. §Unresolved-1 is closed in favour of the short form it recommended.

**A hosted registry service.** Rejected for now, and it is on the `ROADMAP.md` tripwire list rather than dismissed: a network-resolved registry would make the read predicate depend on availability, which is not acceptable for a rule that decides whether a stored log is readable.

**Allowing deregistration with a deprecation window.** Rejected in A.4. A window helps a party that is still writing types; it does nothing for logs already written, which are the ones that break. There is no window length that makes a stored log un-break.

## Unresolved questions

1. Whether a registrant should be required to have a published discovery document at registration time. Not required here — it would exclude a host registering before its first deploy, which is precisely when it needs the org.
2. Whether `note` should carry a contact. Deferred: the registry is shipped in a public npm package, and putting contact details in it makes it a distribution channel for personal data.

## Acceptance criteria

- [x] `extensions` entries are governed by a written procedure; a second org can be added without inventing one. — evidence: §A (this RFC) — `spec/v2/declaration.json` `extensions` has three orgs registered under it (2026-09-17)
- [x] The registrar is unambiguous (A.1) and the refusal predicate is not host-controlled. — evidence: §A.1 (2026-09-17)
- [x] The effective date is the release, not the merge (A.5), and the corollary skew behaviour is stated. — evidence: §A.5 (2026-09-17)
- [x] Deregistration is foreclosed before anyone attempts it (A.4), with the retroactive-unreadability reason recorded. — evidence: §A.4 (2026-09-17)
- [x] The era-2 reader rule is left to RFC 0176 §A.3 / `persistence.md` §The reader rule (A.4a): this RFC binds the WRITER only. Asked and answered 2026-09-14 on a production census — the refusal stands, and `v2-unmapped-type-refused` still witnesses both halves unchanged. — evidence: §A.4a; `persistence.md` §The reader rule (2026-09-17)
- [x] RFC 0169 §Unresolved-1 is closed in favour of the short form. — evidence: RFC 0169 §Unresolved (2026-09-17)
- [x] `spec-corpus-validity` stays green; `openwop-check.sh` passes on the merged tree. — evidence: `openwop-check.sh` green on main at every merge since (2026-09-17)

## References

- `spec/v2/core/persistence.md` §"The codemap is data" — the refusal that turns on registration
- `spec/v2/declaration.schema.json` — entry shape, `extensionsKeyPattern`, `reservedOrgs`
- `spec/v2/core/conformance.md` §"Witness class" — negative-existence
- RFC 0169 §Unresolved-1 — the org-form question this closes
- RFC 0171 §A.1 — `openwop.` as the only reserved prefix; §A.5 closed-enum growth
- `COMPATIBILITY.md` §2.1 — additive
- `GOVERNANCE.md` §"Sole-steward operation" — the waived comment window
