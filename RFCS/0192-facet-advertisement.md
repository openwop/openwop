# RFC 0192: a facet is advertised by the presence of its key

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0192                                                            |
| **Title**         | the v2 facet advertisement semantic, the 26 descriptions that still gated on a retired field, and the generator that stops the 27th |
| **Status**        | `Accepted`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-19                                                      |
| **Updated**       | 2026-09-19 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: no identity, authorization, isolation, idempotency, replay, external-effect or certification surface changes.) · **Active → Accepted 2026-09-19.** Evidence tier: corpus gate — every requirement id in the falsifiability table carries a row in `evidence/corpus-ledger.json`, minted by `conformance/src/coherence/`. No host bundle is involved: these RFCs govern gates over source artifacts, and their witnesses are `witnessable — unaided (corpus)`. The generator guard has been exercised by sabotage, not a clean-tree exit 0: a reintroduced ghost in a facet override fails the generator by path. |
| **Affects**       | `spec/v2/core/capabilities.md` · `scripts/generate-from-declaration.mjs` · `spec/v2/facets/packs.schema.json` · `spec/v2/facets/workflowChainPacks.schema.json` |
| **Compatibility** | `additive`                                                      |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v2 retired the `supported` flag. `spec/v2/core/capabilities.md` says what that means for a **family** — *"presence of the record is the claim"* — and says nothing about a **facet**. Twenty-six facet descriptions still condition a MUST on `supported: true`, a field the closed schema forbids. This RFC states the facet rule, rewrites the twenty-six, and makes the twenty-seventh impossible to add silently.

## Motivation

`scripts/generate-from-declaration.mjs` strips `supported` recursively — it was written for the family-level flag that RFC 0169 §A.2 retired into `{status, since, until?}`. Nothing replaced it at the facet level. Measured at corpus 2.15.1: `"supported"` appears **0** times as a property key in `schemas/v2/capabilities.schema.json`, against **175** in the v1 schema, while **26** descriptions still say things like *"Hosts that advertise `supported: true` MUST include `envelope.failed`"* and *"MUST be `true` when `supported` is `true`"*.

**A MUST that cannot fire is a relaxed MUST.** Those are not stylistic leftovers; each is an obligation the corpus publishes and no host can trigger.

The gap is precisely one table row. `capabilities.md` §2 rules on families:

> `supported` — does not exist; presence of the record is the claim, and a host that does not support a family MUST omit it

The adjacent `facets` row says what a facet *is* and nothing about what its presence claims.

**Hosts already converged on the answer, independently.** `httpClient.safeFetch` is emitted as `{}` — the v1 `{supported: true}` with the flag removed, presence carrying the whole claim. `agents.orgChart` appears only where `agents.roster` does, exactly as the unstatable `roster.supported: true` intended. The semantic was real and unwritten.

**It is not simply "presence of the object", and the difference matters.** Not every facet is an object — `httpClient.ssrfGuard` and `memory.writable` are booleans, so the rule is presence of the **key**. And one facet inverts the default: `memory.writable`'s own description says *"Absent ⇒ the host implements the full RFC 0004 four-operation MemoryAdapter… A read-only host MUST set `writable: false`."* A blanket "absent ⇒ unsupported" would invert it. The rule therefore carries an explicit exception for a facet whose schema states a meaning for its own absence.

## Proposal

### §A The rule

`spec/v2/core/capabilities.md` §2, the `facets` row:

> a facet is advertised by the presence of its key, and a host MUST omit the key for a facet it does not offer, except where the facet's own schema states a meaning for its absence

A `supported`-gated conditional is **migrated, not dropped**. v1 said *"if `supported: true` then these fields are required"*; under presence-semantics the antecedent is the facet being present, so the rule becomes an unconditional `required` on the facet. Deleting them had silently relaxed `memory.compaction ⇒ trigger` and `memory.injectionBudget ⇒ tokenCounter` — both still *described* as "enforced via the `if/then` clause", naming a clause that was no longer there.

### §B The twenty-six

Rewritten by hand, keyed on the exact v1 sentence, in a table inside the generator. A bulk regex is unsafe: they say materially different things — opt-in, conditional-required, cross-family reference, and one three-way combinatorial explanation (`prompts.endpointsSupported`) that collapses entirely under presence-semantics. Two are hand-authored override text (`spec/v2/facets/packs.schema.json`, `workflowChainPacks.schema.json`) and are edited in place.

### §C The twenty-seventh

The v1 seed is still the source, so a newly-seeded family arrives with the same idiom. `generate-from-declaration.mjs` now **fails** when it would emit a description conditioning on `supported`, on both the `--write` and `--check` paths, naming the path and telling the author where to fix it.

It fails the generator rather than a separate checker deliberately: `generate-deprecation-annotations.mjs` also writes `schemas/v2/capabilities.schema.json`, and 2.10.0 established that a correction applied as a post-pass is overwritten by whichever generator runs last.

## Compatibility

`additive`. A JSON Schema `description` is an annotation, never an assertion (JSON Schema 2020-12 §7 vs §10), so no host discovery document changes validity from the rewrites. The §A conditional migration **tightens** two facets that had been silently relaxed, restoring obligations RFC 0012 §A and the injection-budget contract already stated; all three bundles in `evidence/v2-host-bundles/` validate.

The rule itself narrows what a conforming host may do — it states an obligation (`MUST omit`) that was previously unstated — which `RFCS/README.md` classifies as a normative addition requiring an RFC, and is why this is one.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A a facet is advertised by its key's presence | `openwop.requirement.0192.facet-presence` — `capabilities.md` §2's facets row states the rule WITH the absence exception, asserted by `conformance/src/coherence/v2-facet-advertisement.test.ts` | any contributor, by editing the row | witnessable — unaided (corpus) |
| §B no published description conditions on a retired field | `openwop.requirement.0192.no-supported-ghost` — zero descriptions in `schemas/v2/capabilities.schema.json` match `supported` outside the generated root note | any contributor, by seeding a new family | witnessable — unaided (corpus) |
| §C the generator refuses to emit one | `openwop.requirement.0192.no-supported-ghost` — reintroducing the idiom in an override fails `generate-from-declaration.mjs` by path | any contributor | witnessable — unaided (corpus) |


## Acceptance criteria

- [x] `Draft → Active`: the facet advertisement rule is stated in `capabilities.md` §2 with the absence exception, all 26 stale descriptions are rewritten, `supported`-gated conditionals are migrated to `required` rather than dropped, and the generator refuses the 27th.
- [x] `Active → Accepted`: every requirement id in the falsifiability table carries a row in `evidence/corpus-ledger.json`, and the generator guard has been exercised against a reintroduced ghost (sabotage, not a clean-tree exit 0).

## Alternatives considered

**State the rule for facets by extending the family row.** Rejected: the family row is about records, the facet row about fields, and conflating them is what left the gap.

**Bulk-rewrite the descriptions with a regex.** Rejected, and measured: the 26 carry at least five distinct semantics.

**Leave the descriptions and only state the rule.** Rejected: 26 published MUSTs that cannot fire is the defect, not the absence of a sentence.

**Put the rule in a family's behaviour home.** Rejected: it is cross-cutting, so it would scatter across twelve documents. It is spent in `capabilities.md`, which RFC 0189 §A refuses as a family's *behaviour* home — correctly, and irrelevantly, since this is a rule about record shape, which is that document's own subject. Note the cost: words there earn no cap credit, by design.

## Unresolved questions

**Q1.** A host has no way to say *"I know about this facet and do NOT offer it"*. MyndHyve expresses exactly that today as `extensions.myndhyve.runs.pauseResume.supported = false` — fleeing to the vendor namespace because the core root cannot say it. Whether a negative advertisement is worth a wire surface is left open; presence-semantics makes omission the only spelling.
