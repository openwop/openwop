# RFC 0227: a generated restatement of a registry is not kernel prose

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0227                                                            |
| **Title**         | a generated restatement of a registry is not kernel prose       |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-28 — filed `Draft`; the 7-day comment window opens with the pull request and closes 2026-10-05. The window is **not** waived. The maintainer approved drafting it (openwop #1698, architect batch 2: "separate editorial PR for later (the maintainer decides)"). · 2026-09-29 — split for filing: this RFC loosens the kernel budget, so the filing PR carries the RFC only, and the §C change lands with the `Draft → Active` flip (the RFC 0219 pattern, #1672). The §C change is prepared on branch `rfc/0227-mechanism`. Re-measured after 73/73 families were homed (the RFC 0190 §A cap is now final at 37,800) and RFC 0228 registered nine codes. · 2026-09-29 — **`Draft → Active`; comment window waived** (7-day, filed 2026-09-28, 1 day elapsed, not run) at the maintainer's explicit direction, logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" and `docs/WAIVER-RETROSPECTIVE-REGISTER.md`. Routine bootstrap waiver under GOVERNANCE §"Sole-steward operation", not an RFC 0147 §A.6 override: the RFC amends a corpus budget gate and re-points a server-free corpus-coherence row; no certification bundle, witness or replay digest covers either, and no identity, authorization, isolation, idempotency, replay or external-effect surface changes. The §C change lands in the same PR, re-measured on `origin/main` bee239e1. The evidence gate is not waived. |
| **Affects**       | RFC 0190 §A (amended) · `scripts/check-core-budget.mjs` (a guarded `spec/v2/generated/` directory) · `scripts/generate-error-envelope.mjs` (writes the table doc whole; `--check` compares it byte-for-byte) · `spec/v2/core/errors.md` §Codes by HTTP status (the table becomes a link) · new `spec/v2/generated/error-codes.md` · `conformance/src/coherence/v2-error-registry-prose-parity.test.ts` (`openwop.requirement.0171.error-registry-prose-parity` re-pointed) |
| **Compatibility** | `editorial + gate` (COMPATIBILITY.md, the RFC 0190 class): no wire artifact, no schema shape, no endpoint contract, no error meaning, and no MUST added, moved or relaxed |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0190 §A budgets every word of `spec/v2/core/**` against a single kernel cap, and says where prose is filed has no budget consequence. `spec/v2/core/errors.md` carries a 120-row "Codes by HTTP status" table (about 360 words). A generator writes it from `spec/v2/errors.json`, and it adds nothing the registry does not already say. Every new error code therefore costs kernel words, although no rule has changed. This RFC excludes one narrow thing from the measured set: a restatement of a machine-readable registry that a repo generator writes whole and a gate checks byte-for-byte. The table moves to `spec/v2/generated/error-codes.md`, and `errors.md` keeps a link and the count.

## Motivation

- **The budget is counting the registry twice.** The normative source of every code, status and retriability is `spec/v2/errors.json` (`errors.md` §The registry). The table is a view of that file for reading, and it is regenerated whenever the file changes. Budgeting it charges the kernel for data it does not own, and a reader who reads the table learns no rule that the registry and §The registry do not already state.
- **It charges the kernel for data, not rules.** Each registry row adds a table row to `errors.md`, so every newly registered code costs kernel words although no rule has changed: RFC 0226's three codes cost 9, and RFC 0228's nine cost 27. Measured codification of shared codes is exactly the work the registry exists for, and the budget should not price it as if it were new front-door prose. (This is first a question of what the budget measures. It now also bears on headroom: every v2 core family has a v2 home, so the cap `25,000 + 200 × (homed − 9)` no longer grows, and the kernel is 37,713 / 37,800. Each further registry row would take kernel words that no rule used.)
- **The reading-burden invariant is unaffected.** RFC 0190 §A protects "an implementer can read the entire front door in one sitting". A lookup table of 120 code/status pairs is reference data, not front-door reading, in the same way the registry JSON itself is not counted.

## Proposal

### §A. The exclusion (amends RFC 0190 §A)

RFC 0190 §A's measured set gains one exclusion:

> A document under `spec/v2/generated/` is outside the measured set when **(a)** a repository generator writes it whole from a machine-readable registry under `spec/v2/` or `schemas/v2/`, **(b)** that generator's `--check` compares it byte-for-byte and runs in `npm run openwop:check`, and **(c)** `scripts/check-core-budget.mjs` lists it against its generator, whose name appears in the document's banner. Prose written by hand about a registry (its rules, its growth, what a code means in context) stays in `spec/v2/core/` and stays counted.

`check-core-budget.mjs` enforces (c) and fails on any file in `spec/v2/generated/` that is not registered against a generator, or whose banner does not name that generator. It reports the unbudgeted words so they stay visible. Generator checks enforce (b). No other directory changes.

### §B. Why this does not reopen what RFC 0190 §B closed

RFC 0190 §A and §B were written to stop one move: filing a family's contract somewhere unmeasured so that it costs no budget (the "zero-word resolution"). That move works because the relocated text still carries rules the kernel no longer counts. This exclusion cannot carry a rule, for three reasons:

1. **Nothing hand-written can live there.** The directory admits only files a registered generator writes whole, and each generator's `--check` fails on any byte that differs from its output. A sentence of prose added to `error-codes.md` fails the gate. A new hand-written file in the directory also fails the gate.
2. **The source stays normative and stays in scope.** The generator's input (`spec/v2/errors.json`) is the normative registry, and the rules about it stay in `spec/v2/core/errors.md` and are counted. The generated file restates data the corpus already holds; removing it would lose no rule.
3. **It is not a home.** A generated document is not a `normativeText[]` target, and nothing here changes which documents can be one (RFC 0190 §B, RFC 0189 §B). A family cannot resolve against it.

So the budget still counts every rule a human wrote, and it stops counting the registry a second time.

### §C. The implementing change (lands with `Draft → Active`)

This RFC loosens the budget, so none of §C took effect while it was `Draft`: the filing PR carried the RFC and its registers only. The change below landed with `Draft → Active` (2026-09-29), merged forward from branch `rfc/0227-mechanism` and re-measured.

- `spec/v2/generated/error-codes.md`, written whole by `scripts/generate-error-envelope.mjs`. It has a banner naming the generator, the count, the registry table and a *Sources:* line. The generator's `--check` fails if the file is stale or hand-edited.
- `spec/v2/core/errors.md` §Codes by HTTP status becomes one sentence: "Every registered code, by HTTP status, is listed in `error-codes.md` (linked), generated from `spec/v2/errors.json` (120 codes)." The generator keeps both counts current, and no rule text moves.
- `scripts/check-core-budget.mjs` gains the §A guard and reports the excluded words.
- `openwop.requirement.0171.error-registry-prose-parity` is re-pointed. The property it protects, that a reader of the spec finds every registered code and the stated counts are true, is kept at the table's new home. `errors.md` MUST link the generated table, the table MUST hold every registered code, and every count either document states MUST equal the registry.
- `spec-artifacts/` mirrors the new document (`spec/v2/**/*.md` is already in its set).

**Kernel budget** (re-measured 2026-09-29 on `origin/main` bee239e1 plus the §C change, after 73/73 homing and RFC 0228's nine codes): 37,713 / 37,800 before, **37,351 / 37,800** after (−362). The 417 words of the generated document are reported by the gate as unbudgeted.

## Compatibility

`editorial + gate`, the class of RFC 0190 itself. No wire artifact, schema shape, endpoint, error meaning or status changes, and no MUST is added, moved or relaxed: the rule fingerprint of `spec/v2/` is unchanged (`check-spec-readability.mjs`). A client or host that read the table in `errors.md` finds the same table one link away, and the published `@openwop/spec-artifacts` ships it at `spec/v2/generated/error-codes.md`.

## Conformance

`openwop.requirement.0171.error-registry-prose-parity` (corpus coherence, server-free) is re-pointed as §C describes. Sabotage checks, run on the §C change before filing (branch `rfc/0227-mechanism`):

- Deleting one row from `error-codes.md` fails both the generator's `--check` ("stale or hand-edited") and the parity row ("every registered code MUST appear in the generated table").
- A stray hand-written file in `spec/v2/generated/` fails `check-core-budget` ("no generator is registered for it").

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A only generator-written registry restatements sit in `spec/v2/generated/`, byte-checked | `check-core-budget.mjs` and `generate-error-envelope.mjs --check` in `npm run openwop:check` | the corpus gate | witnessable — unaided (corpus) |
| §C a reader of the spec finds every registered code (`openwop.requirement.0171.error-registry-prose-parity`) | `errors.md` links `error-codes.md`, which holds every code, and every stated count equals the registry | the corpus gate | witnessable — unaided (corpus) |

## Alternatives considered

1. **Leave it to the cap.** The cap grows only as debt is retired (RFC 0190; RFC 0189 has since raised it), and a registry table is not debt. Headroom would hide the miscount, not correct it: every future registry row would still be charged as kernel prose.
2. **Exclude any generated file wherever it sits.** "Generated" is a claim a gate must check. Scoping the exclusion to one guarded directory, with a registered generator per file, keeps it checkable.
3. **Drop the table and link the JSON.** The table is useful to a human reader, costs nothing once it is outside the kernel, and the parity row already guarantees it is complete.

## Unresolved questions

None.

## Acceptance criteria

- [x] `Active`: the comment window closes (2026-10-05) with no unresolved objection, and the §C change lands in the same PR, re-measured on the tree it merges into. RFC 0190 gains its `Amended by` row then. *(2026-09-29: the window was waived at the maintainer's direction, not run; the §C change and RFC 0190's row landed with the flip.)*
- [ ] `Accepted`: `openwop.requirement.0171.error-registry-prose-parity` has an `executed-pass` row in `evidence/corpus-ledger.json` at the re-pointed location, and `check-core-budget` reports the exclusion.

## References

- RFC 0190 §A, §B (the kernel budget and the zero-word resolution it closed); RFC 0189 §B.
- openwop #1698 (architect batch 2, the "separate editorial PR" item), #1751 (RFC 0226, whose three codes cost 9 kernel words).
- `spec/v2/core/errors.md`, `spec/v2/errors.json`, `scripts/generate-error-envelope.mjs`, `scripts/check-core-budget.mjs`.
