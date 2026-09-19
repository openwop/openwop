# RFC 0193: a capability record is an object, so a v1 array needs a seat

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0193                                                            |
| **Title**         | the three envelope families whose payload the v2 generator dropped in silence, the live `stable` record with nothing in it, and the guard that stops the fourth |
| **Status**        | `Accepted`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-19                                                      |
| **Updated**       | 2026-09-19 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 IS engaged — this changes a prompt-injection surface — and the §A.6 treatment is discharged in §E below rather than waived.) · **Active → Accepted 2026-09-19.** Evidence tier: corpus gate. Every requirement id in §F carries a row minted by `conformance/src/coherence/v2-envelope-catalog.test.ts`, and the generator guard is exercised by sabotage (removing a seat file makes the generator refuse by family name), not by a clean-tree exit 0. |
| **Affects**       | `scripts/generate-from-declaration.mjs` · `spec/v2/facets/{supportedEnvelopes,schemaVersions,envelopeStrictness}.schema.json` · `spec/v2/core/events.md` · `spec/v2/core/versioning.md` · `spec/v2/declaration.json` · `spec/v2/errors.json` · `SECURITY/invariants.yaml` |
| **Compatibility** | `additive`                                                      |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A v2 capability record is an object. `scripts/generate-from-declaration.mjs` builds one by
splicing the seeded v1 property's `properties` in as siblings of `status`/`since`/`until`/`witness`.
A v1 family that **was** an object therefore kept its payload. A v1 family that was an **array**, a
**map**, or an **enum** has no `properties` at all — so its payload was dropped, with no error, and
the record still validated.

That is exactly three families, and they are one flow: `supportedEnvelopes` (the envelope-kind
catalog), `schemaVersions` (the per-kind version floor), `envelopeStrictness` (the drift mode).

This RFC gives each a named seat, states what an **absent** seat means, and makes the generator
refuse rather than drop.

## Motivation

### The live record

MyndHyve's production v2 discovery document, today, side by side:

```
limits             {"status":"stable","since":"1.0","witness":"witnessable-gated",
                    "clarificationRounds":3,"schemaRounds":2,"envelopesPerTurn":5, …}
supportedEnvelopes {"status":"stable","since":"1.0","witness":"witnessable-gated"}
```

`limits` was a v1 object, so it came across whole. `supportedEnvelopes` was a v1 array, so what
survived is a `stable` claim to an envelope-kind catalog **containing no catalog**.

The host did nothing wrong. It filled in every field the schema offered it. The schema is what is
vacuous — and a vacuous claim that a host cannot even express honestly is the failure mode the
whole v2 witness framework exists to prevent.

### The fail-open

`unknown_envelope_kind` is *defined* by reference to the list: `spec/v1/ai-envelope.md`
§"Refusal taxonomy" reads **"Unknown `type` (not in `supportedEnvelopes`)"**. The protocol-tier
invariant `prompt-injection-envelope-typecheck` says the same: *"Envelope types validated against
capabilities.supportedEnvelopes."*

At major 2 there is no such list. The invariant's stated mechanism **does not exist**, and an
implementer reading "no list" as "nothing to check" admits every kind an attacker can name. This is
the same fail-open class as the RFC 0132 guard found deleted in 2.14.0: a control whose input
quietly went missing while the rule that cites it stayed on the page.

### The corpus contradicting itself

`versioning.md` §2 axis 6 rules `schemaVersions` **first-class**, which that table's own legend
defines as *"own schema-enforced grammar and negotiation rule"*, owner `events.md`. The generated
schema gives it the uniform record — which the same legend calls **`retire`**.

One document, two dispositions for one axis. Not a gap; a contradiction, and the same shape as the
`packs.md:37` defect corrected in 2.22.0.

## Proposal

### §A — the seat rule

A family whose v1 value was not an object holds that value in a **named seat** in its v2 record.
The generator cannot mint the name: the v1 value *was* the whole property, so there is nothing to
name it after. The name is therefore decided by hand in `spec/v2/facets/<key>.schema.json`, the
override mechanism that already exists and whose `properties` already become record siblings.

### §B — the three seats

| family | v1 shape | seat | v2 grammar |
| --- | --- | --- | --- |
| `supportedEnvelopes` | `array<string>` | `kinds` | array, unique, kind strings |
| `schemaVersions` | `map<integer>` | `kinds` | `propertyNames` = kind grammar; values `integer, minimum 0` |
| `envelopeStrictness` | `enum[warn\|strict]` | `mode` | the same enum |

Every seat is **OPTIONAL in the schema**. A required seat would invalidate MyndHyve's published
closed record with no host change — the rule that already kept `observability.testSeams` at 2.x.
The obligation lives in prose, at the point of use, where absence can be given a safe meaning
instead of an undefined one.

### §C — what an absent seat means (the fail-closed reading)

`events.md` §"The envelope-kind catalog" is the normative home for all three.

- **`supportedEnvelopes.kinds` absent is not an empty catalog and is not an unrestricted one.** The
  host has made no catalog claim, and an engine MUST refuse every non-universal kind with
  `unknown_envelope_kind`. Absence reading as "unrestricted" is precisely the fail-open above.
- **`schemaVersions.kinds`** — a kind absent from the map has a floor of `0`. An emitted
  `schemaVersion` above the floor MUST refuse with `unknown_schema_version` whatever the strictness.
- **`envelopeStrictness.mode` absent means `warn`**, as in v1 — never "no checking".

### §D — the axis-6 correction

Axis 6's stated grammar was `additionalProperties: false` over declared kinds. Implemented
literally that forbids vendor kinds — which `ai-envelope.schema.json` *requires* to be namespaced
and host-published, never corpus-declared. A closed enum would forbid the entries the catalog
exists to carry. The row now reads `propertyNames` = the kind grammar, and says why it is not an
enum.

### §E — RFC 0147 §A.6 treatment (prompt-injection surface)

§A.6 is engaged and is discharged, not waived. The change is strictly **restrictive** on the
injection surface: before, a major-2 host had no list and any reading of the refusal rule that
admitted unlisted kinds was unconstrained; after, the absent-catalog case is pinned to *refuse*.
There is no configuration of seats under which a kind admitted after this RFC would have been
refused before it. The invariant's `note` now records the major-2 mechanism and names the
fail-open explicitly so the next reader cannot re-derive the permissive reading.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B each family carries its seat | `openwop.requirement.0193.seats-present` — the three records in `schemas/v2/capabilities.schema.json` carry `kinds`/`kinds`/`mode`, sourced `x-openwop-facets-from` | any contributor, by deleting a seat file | witnessable — unaided (corpus) |
| §B no seat is required | `openwop.requirement.0193.seats-optional` — no seat appears in its record's `required[]`, so a published record without one stays valid | any contributor, by adding it to `required` | witnessable — unaided (corpus) |
| §A the generator refuses an unspliceable payload | `openwop.requirement.0193.generator-refuses` — removing a seat file makes `generate-from-declaration.mjs` fail by family name | any contributor | witnessable — unaided (corpus) |
| §C an absent catalog fails closed | `openwop.requirement.0193.absence-is-closed` — `events.md` §"The envelope-kind catalog" states the absent-`kinds` refusal with a 2119 MUST | any contributor, by softening the sentence | witnessable — unaided (corpus) |
| §C both refusal codes exist at major 2 | `openwop.requirement.0193.codes-registered` — `unknown_envelope_kind` and `unknown_schema_version` have rows in `spec/v2/errors.json` | any contributor | witnessable — unaided (corpus) |
| §D axis 6 agrees with the record | `openwop.requirement.0193.axis-6-agrees` — the row reads `propertyNames`, not `additionalProperties: false` over declared kinds | any contributor, by reverting the cell | witnessable — unaided (corpus) |

## Compatibility

**Additive.** Three OPTIONAL properties on three existing OPTIONAL records; two error codes
registered that v1 prose already required a host to emit; one corrected table cell; one clarified
invariant note. No required field changes, no field is removed or retyped, no existing MUST is
relaxed — §C *adds* a refusal where behaviour was undefined. Every currently published v2 discovery
document, including the vacuous one that motivated this RFC, remains valid.

Through the overlap `preferredVersion` stays `1.x`.

## Acceptance criteria

- [x] `Draft → Active`: the three seats exist in `spec/v2/facets/`, their meaning-when-absent is stated in `events.md` with a 2119 MUST, the generator refuses an unspliceable payload rather than dropping it, both refusal codes are registered at major 2, and `versioning.md` axis 6 no longer contradicts the record it describes.
- [x] `Active → Accepted`: every requirement id in the falsifiability table carries a row in `evidence/corpus-ledger.json`, and the generator guard has been exercised by removing a seat file in a scratch corpus (sabotage, not a clean-tree exit 0). The optionality leg is asserted against the live published record it was written to protect.

## Alternatives considered

**Make the seats required.** Rejected on measurement, not taste: MyndHyve already publishes
`supportedEnvelopes` and `schemaVersions` without them, and the v2 root is `additionalProperties:
false`, so a required seat invalidates a live document with no host change.

**Let the generator mint the seat name automatically** (e.g. always `value`). Rejected: it would
have produced `supportedEnvelopes.value` and `schemaVersions.value`, which say nothing, and it
would have hidden the more important question — what absence *means* — behind a mechanical default.
The generator refusing is what forces that question to be answered per family.

**Leave it and document the array form in prose.** Rejected: the schema is the closed contract, and
a host cannot publish a field the closed root forbids.

## Unresolved questions

- **Q1.** No host advertises `envelopeStrictness` at all yet, so `mode` has no live witness. The
  corpus gate covers the shape; the behavioural leg needs a host that advertises the family.
- **Q2.** `supportedEnvelopes.kinds` is deliberately not constrained to the `<org>.` pattern by the
  schema, because v1 explicitly admits pre-v1.x unnamespaced kinds for backward compatibility. The
  namespacing rule stays a prose MUST. Whether major 3 closes it is deferred.
