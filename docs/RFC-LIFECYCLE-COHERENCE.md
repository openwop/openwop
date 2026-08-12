# RFC Lifecycle Coherence (RFC 0149 §D, UQ4)

> **Status: Measurement (non-normative), 2026-08-12.** RFC 0149 §D proposes failing the corpus generator when an `Accepted` RFC "retains an unresolved acceptance blocker not explicitly carried to a register/known-limit". This document reports whether the obvious signal — the `- [ ]` boxes under §"Acceptance criteria" — can carry that gate. It commits to no gate.

Reproduce with `node conformance/scripts/rfc-lifecycle-report.mjs`.

## Why this had to be measured first

UQ4 asks: *which stale lifecycle statements are intentional historical notes rather than defects?* The answer decides whether §D's gate is a small change or a corpus-wide sweep. Building the gate first and discovering the answer from its failure output would mean either reddening the corpus or watering the gate down until it proves nothing — the second being the failure mode this whole program exists to remove.

## What the corpus contains

Of **141** `Accepted` RFCs:

| | Count | Share | Reading |
|---|---:|---:|---|
| All acceptance boxes ticked | 59 | 42% | signal maintained |
| **Some ticked, some not** | **34** | **24%** | **the triage set** |
| Boxes present, none ticked | 35 | 25% | signal never used |
| No acceptance checkboxes at all | 13 | 9% | nothing to read |

Only one RFC (`0043-registry-and-extension-policy.md`) carries unchecked boxes *outside* an acceptance section, so section attribution is not a confounder.

## The finding: the signal is inconsistent, not absent

This is the distinction that decides the design. Had checkboxes been universally unmaintained, they would simply be noise and §D would need a different signal entirely. Had they been universally maintained, the gate would be a one-line addition.

Neither holds. **42% maintained it, 25% never used it.** A blanket gate on unchecked boxes would fail 69 RFCs, most of them for an authoring convention rather than an unresolved blocker — and a gate that fires 69 times on its first run does not get fixed, it gets disabled.

**The 34 partial RFCs are the signal worth having.** In those, someone was actively ticking boxes and stopped. That is materially more likely to mark a real unresolved item than the 35 where nobody ticked anything, and the shape of the distribution shows it: `0027` has 13 ticked and 1 not; `0040` has 9 and 1; `0041` has 11 and 2. Those trailing items are the plausible blockers. By contrast `0002` (3 ticked, 4 not) and `0007` (1 ticked, 6 not) look like ticking that was abandoned rather than completed.

## Recommended rule, and its precondition

A gate that works **going forward without a corpus-wide sweep**:

> An RFC that ticks **any** acceptance box MUST tick **all** of them before reaching `Accepted`, or carry the unticked item to a gap register / `docs/KNOWN-LIMITS.md` row.

This is enforceable immediately for new RFCs, needs no retro-fix of the 35 never-ticked ones, and converts the 34 partial RFCs into a bounded triage backlog instead of a wall of CI failures. Ticking nothing stays legal — it means "this RFC did not use the mechanism" — while ticking *some* becomes a claim the gate can hold you to.

**Precondition before the gate can apply to existing RFCs:** triage the 34. Each unticked item is either a real open blocker (→ gap register row), or an item that was completed and never ticked (→ tick it). That is 34 documents of review, not 141.

## What this does not settle

- Whether any of the 34 trailing items is a *material* blocker, as opposed to bookkeeping. Only reading them answers that.
- The other half of §D — "a Stable/FINAL spec describes its owning RFC as pending acceptance". A search of `spec/v1/*.md` for pending-acceptance phrasing near RFC references returned **no** hits, so either the corpus is clean on that half or the phrasing is more varied than the patterns tried. Recorded as unproven rather than clean.
- Whether checkbox state should remain the signal at all, versus an explicit machine-readable field in the RFC header table.

## References

- RFC 0149 §D and UQ4
- RFC 0147 Workstream 2
- `conformance/scripts/rfc-lifecycle-report.mjs`
- `docs/REQUIREMENT-REGISTRY-FEASIBILITY.md` — same measure-before-designing pattern for RFC 0148 G3
