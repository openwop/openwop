# RFC 0166: Register dispositions, terminal RFC states, and witness classes on the assurance registers

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0166                                                            |
| **Title**         | Three process shapes the v2 charter's C.7 and C.11 need in place before the v2 umbrella: a closed disposition vocabulary for every gap and risk register row, machine-checked; a global `spec/v1/gaps.json` with one id namespace; a `witness` class on every `SECURITY/invariants.yaml` entry and `spec/v1/extensions.json` record; `Rejected` as a reachable RFC status; and the RFC 0147 high-risk cohort published as a retrospective queue. |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-02                                                      |
| **Updated**       | 2026-09-02 (`Draft → Active` in the filing PR: tokens on all 919 register rows, 100 backfilled registers, `spec/v1/gaps.json` (538 gaps), `witness` on 191 invariants + 73 extension records with the mechanical-classification marker, `Rejected` reachable, retrospective queue published, three gates in `openwop:check`. Window waived per `GOVERNANCE.md` §"Sole-steward operation" and logged. `Active → Accepted` on the corpus gates alone — see §Acceptance.) · 2026-09-02 (filed)
| **Affects**       | `RFCS/0001-rfc-process.md` (§3 status states: `Rejected`) · `RFCS/README.md` (legend, tally, §"Companion gap & risk registers") · `RFCS/registers/*.{gaps,risks}.md` (disposition token at the head of the Resolution Path / Status cell, every row) · NEW `spec/v1/gaps.json` + `spec/v1/gaps.schema.json` · NEW `scripts/check-registers.mjs`, `scripts/check-gaps.mjs`, `scripts/check-witness-classes.mjs` · `scripts/generate-protocol-status.mjs` (`Rejected` in the tally order) · `scripts/generate-assurance-status.mjs` (reads the disposition token; row coverage 204/204) · `SECURITY/invariants.yaml` (`witness:` on every entry, appended after `note:`) · `spec/v1/extensions.json` (`witness` on every record) · `RFCS/0155-…md` (§D budget repealed in favour of the witness requirement) · `spec/v1/capabilities.md` (§"What a capability may vary" cross-reference) · NEW `docs/RETROSPECTIVE-QUEUE.md` · `docs/ASSURANCE-STATUS.md` (new rows) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` — no wire artifact changes. Process changes are governance amendments per `GOVERNANCE.md` §"Amendments"; the status-vocabulary change to RFC 0001 is why this is an RFC rather than a direct PR. Comment window waived under `GOVERNANCE.md` §"Sole-steward operation" and recorded. |
| **Supersedes**    | — (amends RFC 0001 §3, RFC 0155 §D)                             |
| **Superseded by** | —                                                               |

## Summary

Four register-and-status defects the v2 charter's audit found, each fixed by making the record machine-shaped:

1. **266 gap rows and 227 risk rows are open across Accepted RFCs**, 101 RFCs have no register, and the assurance-status parser sees only 140 of 204 risk rows because cell counts drifted. `RFCS/README.md` already says an Accepted RFC with silently-open rows is a process violation; nothing checks it. This RFC gives every row a closed disposition token at the head of its last cell — `open`, `closed`, `transferred:<target>`, `carried:<gap-id>`, `externally-gated:<tripwire>` — and a gate that fails an `Accepted` RFC with an `open` row.
2. **Twenty disjoint `G<n>` namespaces** with no index. `spec/v1/gaps.json` assigns `openwop.gap.<rfc>.<n>` to every gap row, carries its witness class, owning requirement id, disposition, and sources, and a contradiction gate fails when a gap cites an artifact that contradicts it (three did, closed in Phase 0).
3. **No witness class on the registers that decide what may be claimed.** Every `invariants.yaml` entry and every `extensions.json` record gains `witness` from the closed set `capabilities.md` §"What a capability may vary" already implies: `witnessable-unaided | witnessable-gated | seam-gated | claims-check | negative-existence | unwitnessable`. `tests: []` is expressible only as `unwitnessable` with a rationale; a protocol-tier `unwitnessable` fails the gate. RFC 0155 §D's 12/4 extension budget, never enforced and never calibrated, is repealed: an extension may exist at any count if it declares what can falsify it.
4. **`Rejected` is not a status**, so declined proposals leave no record, and the tally generator would drop one if it existed. RFC 0001 §3 gains it; the generator's order array gains it; the RFC 0147 high-risk cohort (0148, 0150, 0152, 0153, 0154) is published as `docs/RETROSPECTIVE-QUEUE.md` with outcome slots from RFC 0156 §B (`ratified | corrective-rfc-required | provisional | withdrawn`).

## Motivation

The waiver audit's conclusion — "a status can be waived; 41 were; a non-vacuous witness on a deployed host cannot" — applies one layer down to the registers. A register row is where the project writes what it could not yet witness. If that row's state is free text, the project cannot answer "how many open gaps are there" without reading 161 RFCs, cannot fail a promotion on an open row, and cannot tell a gate which invariants are falsifiable by an advertisement-independent probe. Phase 0 found the consequences: RFC 0106 Accepted with a row calling itself the Accepted gate; three spec gap tables asserting endpoints were deferred after they had landed; 31 of 184 invariants outside the CI gate with no field saying so.

The v2 umbrella RFC (charter Phase 2) will carry a falsifiability table as data and a disposition on every register row; this RFC builds the shapes and gates it will write into.

## Proposal

### §A — Disposition tokens on register rows

**§A.1 Vocabulary.** The `Resolution Path` cell of every gap row **MUST** begin with exactly one gap token, and the `Status` cell of every risk row with exactly one risk token. Gap tokens:

| Token | Meaning | Required argument |
| --- | --- | --- |
| `open` | not resolved | — |
| `closed` | resolved in this RFC or its suite; the cell says where | — |
| `transferred:<target>` | moved to a tracked surface | an RFC number, a `docs/` path, or a `ROADMAP.md` anchor |
| `carried:<gap-id>` | carried forward as a named gap | an id in `spec/v1/gaps.json` |
| `externally-gated:<tripwire>` | held on a condition outside the project | a `ROADMAP.md` tripwire name or `legal` / `non-steward-host` / `working-group` |

Risk tokens: `open` · `mitigated` (the mitigation column is in force) · `accepted` (the risk is knowingly carried as-is, and the cell says by whom) · `closed` · `transferred:<target>`. A risk is a standing condition, not a gap; an `open` risk on an Accepted RFC is permitted but **ratcheted** — the count is published in `docs/ASSURANCE-STATUS.md` and may not grow.

Free text follows the token (the existing prose is kept; the token is prepended, rendered in backticks). Legacy forms (`**CLOSED**`, `~~…~~`, `Realised and remediated`, `**OPEN — TRANSFERRED**`, `Carried`, `Mitigated`) were mapped once by `scripts/backfill-registers.mjs` on 2026-09-02 (idempotent; a row whose cell already begins with a valid token is left alone). From this RFC a row without a token fails `scripts/check-registers.mjs`.

**§A.2 Gate.** `scripts/check-registers.mjs` (in `openwop:check`): every row has a valid token for its kind; an argument-taking token has its argument; a `carried:` id exists in `gaps.json`; an RFC whose `Status` is terminal (`Accepted`, `Superseded`, `Withdrawn`, `Rejected`) has no `open` **gap** row (open gap rows are permitted only under `Draft` or `Active`). The gate prints counts per token; the open-risk count is the ratchet.

**§A.3 Backfill.** The 100 register-less RFCs (162 RFCs, 62 with a register at filing) get a one-line register each (`RFCS/registers/<nnnn>-<slug>.gaps.md` with the header and a single row `G0 | — | No gaps were recorded at authoring; opened by RFC 0166 backfill | Spec Architect | closed — nothing to carry | —`) so that "no register" and "empty register" are distinguishable. Existing open rows on Accepted RFCs are dispositioned during the backfill: `carried:` into `gaps.json` where the gap is real, `closed` where the register outlived its status (the RFC 0106 class), `externally-gated:` where a tripwire holds it.

### §B — `spec/v1/gaps.json`

**§B.1 Shape.** Schema at `spec/v1/gaps.schema.json` (kept out of `schemas/`, as `deprecations.schema.json` is). One entry per gap:

```json
{
  "id": "openwop.gap.0140.7",
  "rfc": "0140",
  "local": "G7",
  "surface": "replay side-effect suppression — the effect seam set is not enumerable in the spec",
  "witness": "unwitnessable",
  "requirementId": "openwop.it.replay-side-effect-suppression.every-host-effect-seam-is-suppressed",
  "disposition": "carried",
  "target": "v2 charter C.6 — host-declared effect-seam manifest",
  "sources": [{ "file": "RFCS/0140-replay-side-effect-suppression.gaps.md", "token": "not enumerable" }]
}
```

`witness` uses the §C enum. `requirementId` is optional and, when present, MUST exist in `conformance/requirements.json` or its alias file. `disposition` mirrors §A.1 without the argument (the argument is `target`).

**§B.2 Gates.** `scripts/check-gaps.mjs`: schema-valid; unique ids; every `(rfc, local)` pair in a register has an entry and vice versa; every source still contains its token (the Phase 0 contradiction class: a gap whose cited artifact no longer says what the gap says fails); `requirementId` resolves. The falsifiability tables in RFCs 0159/0163/0164/0165 are the first entries with `requirementId` set; the v2 umbrella's tables are written as `gaps.json` entries first and rendered into the RFC.

### §C — Witness classes on the assurance registers

**§C.1 Enum.** `witnessable-unaided` (an advertisement-independent probe falsifies it on any host) · `witnessable-gated` (a probe falsifies it on any host that advertises the surface) · `seam-gated` (only a `/v1/host/sample/*` seam can falsify it) · `claims-check` (only the shape of a claim is checked, never the behavior) · `negative-existence` (the requirement is that something never happens; witnessed by construction — a closed enum, a schema pattern — not by observation) · `unwitnessable` (nothing outside the host can falsify it; a rationale is required).

**§C.2 `SECURITY/invariants.yaml`.** Every entry gains `witness: <enum>` **appended after its last field** (the `check-doc-tallies.mjs` regex requires `tier:` immediately after `id:`; the invariants parser accepts any `\w+:` scalar). Rules, enforced by `scripts/check-witness-classes.mjs`: `tests: []` ⇔ `witness: unwitnessable` and `non_testability_rationale:` present; a `protocol`-tier entry with `witness: unwitnessable` fails; `reference-impl` and `advisory` tiers may be `unwitnessable` with rationale.

**Honesty about the initial classification.** A witness class is a semantic judgement, and the corpus already learned (`capability-declaration-classes.json`, RFC 0144) that heuristics for such judgements are wrong in ways that hide. The 2026-09-02 backfill therefore derives an INITIAL class mechanically (from what the cited scenario can observe: seam reads ⇒ `seam-gated`, gate helpers ⇒ `witnessable-gated`, no driver call ⇒ `claims-check`, host-side or repo-qualified tests ⇒ `claims-check`, `tests: []` ⇒ `unwitnessable`) and stamps every entry `witnessReview: initial-mechanical-2026-09-02` so nobody mistakes it for a reviewed verdict. Review flips the marker per entry. Three ratchets, baselined in `docs/witness-baseline.json` and enforced by the gate: the `unwitnessable` count, the unreviewed-invariant count, and the unreviewed-extension count may only go down.

**§C.3 `spec/v1/extensions.json`.** Every record gains `witness` (initial class: `witnessable-gated` when a scenario gates on the family or names the full capability path, else `claims-check`; marked and ratcheted as in §C.2). RFC 0155 §D's numeric budget (12 concurrent, 4 security-high) is repealed by this RFC; the replacement rule is: an extension **MUST** declare its witness class, and a `securityTier: high` extension **MUST NOT** be `claims-check` or `unwitnessable` once any host advertises it. `generate-extension-registry-coverage.mjs` gains the field in `--check`.

### §D — `Rejected`, and the retrospective queue

**§D.1** RFC 0001 §3 gains a sixth state: `Rejected` — "Maintainers declined; the file remains with the reason in its `Updated` field; the number is never reused." A proposal that is declined **MUST** be filed (a number is never reserved without a file — `RFCS/README.md`). `generate-protocol-status.mjs`'s order array gains `Rejected`; the README legend gains the row.

**§D.2** `docs/RETROSPECTIVE-QUEUE.md`: the five RFCs the RFC 0147 self-audit names (0148, 0150, 0152, 0153, 0154), each with an outcome slot from RFC 0156 §B (`ratified | corrective-rfc-required | provisional | withdrawn`), the reviewer slot (empty until a second organization exists), and a `provisional` default per `docs/WAIVER-AUDIT-2026-08-20.md` recommendation #3. `generate-assurance-status.mjs` reads the queue and reports outcomes; RFC 0156 G3 and R4 are `closed` (published) and `carried:openwop.gap.0156.4` (review not started) respectively.

## Compatibility

`additive`: no schema, endpoint, event, MUST, or error code changes. Governance amendments per `GOVERNANCE.md` §"Amendments" (one approval, CHANGELOG entry); the RFC 0001 status vocabulary is a decision-rule-adjacent change and is therefore carried by an RFC. Window waived and recorded (`GOVERNANCE.md` §"Sole-steward operation").

## Conformance

No host-facing scenario. Corpus gates: `check-registers.mjs`, `check-gaps.mjs`, `check-witness-classes.mjs` in `openwop:check` step 4; `rfc-lifecycle-coherence.test.ts` gains `Rejected` in its accepted set.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 every row carries a token | the register file | anyone editing a register | witnessable, unaided (corpus gate) |
| §A.2 Accepted RFC has no `open` row | `check-registers.mjs` exit code | a status flip | witnessable, unaided (corpus gate) |
| §B.2 gap ↔ register parity, sources hold | `check-gaps.mjs` | any edit | witnessable, unaided (corpus gate) |
| §C.2 `tests: []` ⇔ `unwitnessable` + rationale; protocol-tier never `unwitnessable` | `check-witness-classes.mjs` | any edit | witnessable, unaided (corpus gate) |
| §C.3 security-high extension not `claims-check` once advertised | registry + INTEROP-MATRIX | a host advertising it | witnessable — gated on advertisement |
| §D.1 declined proposals are filed | the `RFCS/` directory | maintainers | unwitnessable by a gate — process rule; the tally makes omission visible |

## Alternatives considered

1. **Free-text dispositions with a smarter parser.** Rejected: the current parser already tries (bold CLOSED, strikethrough, "Realised and remediated") and reads 140 of 204 rows. Vocabulary that machines read must be closed.
2. **A ninth column for the disposition.** Rejected: the assurance-status regex requires exactly eight cells; a new column drops every row. The token at the head of the existing cell keeps the tables parseable.
3. **Keep RFC 0155 §D's budget and calibrate it.** Rejected: nothing enforces it and 73/41 already exceed 12/4; a number nobody can enforce is a fourth dual location. The witness requirement is what the budget was trying to buy.
4. **Do not add `Rejected`; use `Withdrawn`.** Rejected: withdrawal is the author's act, rejection the maintainers'; conflating them hides the project's own decisions.
5. **Derive `witness` mechanically from `tests` globs.** Rejected: the same heuristic failure `capability-declaration-classes.json` documents; the class is a semantic judgement, made once per entry, and the gate guarantees it was made.

## Unresolved questions

1. Whether `gaps.json` should absorb the RFC "Open spec gaps" tables in `spec/v1/*.md` (46 docs) in v1.x or at v2. This RFC indexes the RFC registers; the spec-doc tables are charter C.7's Phase 3 item.
2. Whether `unwitnessable` reference-impl invariants should be re-tiered to `advisory`. Deferred to the classification review.

## Implementation notes (non-normative)

- Backfill is mechanical for the 101 register-less RFCs (one template file each) and reviewed for the open rows on Accepted RFCs; the first pass maps legacy tokens automatically and lists rows that need a human disposition.
- `generate-assurance-status.mjs` row coverage becomes 204/204 once the token is at the head of the Status cell, because the parser stops depending on cell count for closure detection.

## Acceptance criteria

- [x] Tokens on every existing register row (919); legacy forms mapped; `check-registers.mjs` green; no terminal-status RFC with an `open` gap row (382 rows `carried:` into `gaps.json`). (This PR.)
- [x] `gaps.json` (538 entries) + schema + `generate-gaps.mjs --check` green with full register parity. (This PR.)
- [x] `witness` on all 191 invariants and 73 extension records (initial-mechanical, marked); `check-witness-classes.mjs` green; ratchet baseline `docs/witness-baseline.json` (unwitnessable 20; unreviewed 191 / 73). (This PR.)
- [x] RFC 0001 §3 `Rejected`; generator and README updated. (This PR.)
- [x] `docs/RETROSPECTIVE-QUEUE.md` published; RFC 0156 G3 closed. (This PR.)
- [ ] `Active → Accepted` on the corpus gates alone (no host leg): every gate above runs in `openwop:check` and is green at the flip, AND at least one entry per register has had its mechanical witness class reviewed (the unreviewed ratchets have moved), so the flip is not a status edit over an unreviewed backfill.

## References

- v2 charter program items C.7, C.11 and audit ledger rows RFC-01, RFC-08, RFC-12, RFC-13, RFC-16, ART-04, ART-06.
- `RFCS/README.md` §"Companion gap & risk registers"; `docs/WAIVER-AUDIT-2026-08-20.md` §6; `docs/RFC-0147-SELF-AUDIT.md` §A.6; RFC 0155 §C–§D; RFC 0156 §B; `spec/v1/capabilities.md` §"What a capability may vary".
