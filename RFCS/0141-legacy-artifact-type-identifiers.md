# RFC 0141: Legacy artifact-type identifiers — never-conformant status and the replay migration constraint

| Field             | Value                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**           | 0141                                                                                                                                                               |
| **Title**         | Legacy artifact-type identifiers — never-conformant status and the replay migration constraint                                                                     |
| **Status**        | `Accepted`                                                                                                                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts), with the openwop-app reference host                                                                                                |
| **Created**       | 2026-08-08                                                                                                                                                         |
| **Updated**       | 2026-08-08                                                                                                                                                         |
| **Affects**       | `spec/v1/artifact-type-packs.md`, `conformance/src/scenarios/artifact-type-legacy-ids.test.ts`                                                                     |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — prose clarification; no schema, endpoint, or event change                                                                 |
| **Supersedes**    | — (corrects the superseded text of RFC 0138 §"On the `artifactTypeId` constraint", already amended in place 2026-08-07)                                            |
| **Superseded by** | —                                                                                                                                                                  |

## Summary

Hosts that predate RFC 0071 carry artifact-type identifiers outside the canonical reverse-DNS pattern, and the corpus never said what those values *are* or how a host may migrate off them. Worse, the one constraint that matters — **an identifier migration must not rewrite the run-event log** — was real but only derivable by composing three documents, and a merged RFC briefly recommended the forbidden backfill before being corrected. This RFC states, in one normative place: legacy identifiers were **never wire-conformant** (no grandfather clause; they are simply *unregistered*, a legitimate permanent tier); a migrating host **MUST NOT rewrite historical event-carried identifiers**; the conformant migration shape is a **permanent read-side alias** that resolves **everywhere registration is decided, validation included**; and an alias map is a **host-internal compatibility shim, not a conformance claim**.

## Motivation

### The constraint was compositionally derivable, and it got re-derived wrongly — by the steward

`artifact-type-packs.md` makes `artifactTypeId` the value `artifact.created.artifactType` references. `run-event-payloads.schema.json` `$defs/artifactCreated` carries `artifactType` as an event payload field. `replay.md` §"Determinism guarantees" treats the event log as fixed history. Compose the three and the conclusion is forced: **a namespace backfill breaks replay on any conformant host.**

Nobody composed them. RFC 0138 §"Implementation notes", as merged, offered *"migrate durable rows behind a backfill"* as a legitimate strategy — corrected in place on 2026-08-07 (`7e9df023`) after the reference host, blocked on exactly this migration, reached the no-backfill conclusion independently. The error mode is instructive and is why prose in one place beats a derivation across three: the constraint was reasoned about from the identifier's *storage* ("a persisted field" — a database question) instead of the path the value travels (produce → event → log → replay).

### The blocked host, concretely

openwop-app carries `canvas.checklist`, `doc.one-pager`, `brand.kit` — native identifiers predating the canonical pattern, and after its RFC 0138 migration the **only** remaining canonical failures on both its shipped packs. Those values live in its run-event log via node output envelopes. It cannot rename them; it needed the corpus to say what it *may* do, and to say plainly whether shipping an alias makes it "conformant under its old names" (it does not).

Its shipped resolution (openwop-app#3030) labels itself, correctly: *"NOT a conformance claim. Until the corpus states plainly that these ids were never wire-conformant (logged upstream as G5), this is a host compatibility shim."* This RFC is that statement — closing gap G5 of RFC 0138.

### Why the spec is the right place

Every pre-RFC-0071 host faces this migration eventually, and the failure modes are silent: a rewritten log breaks fork determinism; a half-aliased registry silently demotes typed artifacts on green runs. Constraints whose violation is silent and whose derivation is compositional get violated. The corpus owes implementers the composed conclusion.

## Proposal

One new normative subsection: `artifact-type-packs.md` §"Legacy identifiers and migration (normative — RFC 0141)", under §"Binding the existing artifact surfaces". Its four clauses:

1. **Never-conformant, no obligation.** Values outside the canonical pattern were never wire-conformant — no grandfather clause. They are *unregistered* under the existing tier model, which is a legitimate, permanent, first-class status; a host is under **no obligation to migrate**.
2. **MUST NOT rewrite history.** A migrating host MUST NOT rewrite historical `artifact.created.artifactType` values (or any event-carried occurrence). Either fork determinism breaks, or a replayed run emits an identifier the registry no longer knows and the artifact is **silently demoted to unregistered on a green run** — both worse than the non-conformant name, which fails visibly.
3. **The conformant shape: a permanent read-side alias, resolved everywhere registration is decided — validation included.** Aliasing only lookup yields `registered: true` falling into the unregistered escape hatch: the failure clause 2 prohibits, reintroduced one layer up. Because historical events are immutable, the alias is permanent, not transitional.
4. **A shim, not a conformance claim.** Legacy spellings remain non-conformant on the wire; the canonical spellings the alias resolves are what a peer may rely on. A host MUST NOT advertise or imply otherwise.

**Positive example** — the witness host's shape: alias map canonical → native, consulted on lookup and in `validateArtifact`, validator cache keyed off the *resolved* id so both spellings share one compiled schema; a dangling alias does not shadow a real miss (an alias resolves only when its target is registered, so a typo'd canonical id reports unregistered rather than resolving to nothing).

**Negative example** — the two prohibited shapes: (a) a backfill that rewrites `artifact.created.artifactType` in stored events; (b) an alias wired into `isRegisteredArtifactType` but not `validateArtifact`.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1. Against §2.2: no field, event, endpoint, or error change; **no MUST relaxed** — clause 1 states what the schema pattern already enforced, clause 2 states what `replay.md` already implied, clauses 3–4 constrain a migration path the corpus previously left unspecified. A host with legacy identifiers was unregistered-tier before and remains so; a host with no legacy identifiers is untouched. Nothing here makes any previously-conformant behavior non-conformant.

## Conformance

New always-on server-free scenario `artifact-type-legacy-ids.test.ts` (<1s), prose-pinning per the RFC 0138 part-3 pattern — the schema cannot express "MUST NOT rewrite history," so the corpus stating it *is* the testable surface:

1. the canonical `artifactTypeId` pattern exists in the manifest schema and rejects a bare legacy id (`doc.one-pager`) at the entry level — the anchor the prose hangs off;
2. the corpus states legacy ids were **never wire-conformant** with **no grandfather clause**;
3. the corpus states the **MUST NOT rewrite** clause and ties it to `replay.md`;
4. the corpus states the alias is **permanent** and MUST resolve where **validation** is decided;
5. the corpus states an alias map is **not a conformance claim**.

No capability gate: prose-pinning legs are unconditional. Suite `1.64.0 → 1.65.0` (new scenario file ⇒ minor).

**What this does not cover, stated:** no leg exercises a *host's* alias behavior (that a host resolves aliases in validation is witnessed at openwop-app by its own sabotage-verified tests, not by this suite), and no leg can detect a host that rewrote its log — a rewritten log is indistinguishable from an honest one after the fact. The prohibition is enforceable only by the host's own replay integrity, which RFC 0140's suppression capability now also leans on.

## Acceptance evidence (deployed host, predating this RFC)

`Accepted` on landing, on the openwop-app tier-1 reference host — the implementation **preceded** the RFC and was verified from source, not taken from a report:

- **openwop-app#3030 (`c972960a`)** — read-side alias map, canonical → native, permanent by stated design ("the reader must accept the legacy spelling forever"), with the replay derivation in its own words: rewriting *"would either break `:fork` determinism or leave a replayed run emitting an id the registry no longer knows... SILENTLY stops being typed. That is worse than the non-conformant name."*
- **The validation-path clause is theirs**, sabotage-verified on their side: *"`validateArtifact` resolves too, and that is the load-bearing part... removing the resolve there reddens exactly that test."* Clause 3's MUST is written from that finding.
- **The shim-not-claim clause is theirs too**: the commit explicitly declines to claim conformance pending this corpus statement.
- Steward verification: commit and diff read directly (alias module docblock, `validateArtifact` resolution, resolved-id validator cache, dangling-alias guard); 6 tests shipped with it; their backend green at 10162 tests.

Bootstrap-phase steward waiver applied to the comment window per the standing governance note; the evidence tier is the same (tier-1 reference host, source-verified) as RFC 0139's acceptance.

## Alternatives considered

1. **Do nothing.** The constraint stays compositionally derivable, and it has already been mis-derived once *by the corpus's own steward in a merged RFC*. Demonstrated failure history; rejected.
2. **Grandfather legacy identifiers** (bless pre-0071 ids as conformant). Destroys the meaning of the namespace pattern and makes "conformant identifier" host-relative — the exact portability failure RFC 0071 exists to prevent. Also unnecessary: the unregistered tier already gives legacy values a legitimate permanent home. Rejected.
3. **Mandate migration** (require hosts to adopt canonical ids). Forces every pre-0071 host into alias machinery for zero interop gain — an unregistered value is already handled honestly by every conformant consumer. Rejected; clause 1 explicitly states no obligation.
4. **A protocol-level alias surface** (advertise aliases in discovery so peers can resolve legacy spellings). Would turn a host-internal shim into wire surface and invite peers to depend on non-conformant names — the opposite of the goal. Rejected; clause 4 exists to prevent exactly this.
5. **Fold into RFC 0140.** Both lean on fixed history, but 0140 is a capability with host behavior to gate; this is prose stating status and a prohibition. Separate concerns, cross-referenced instead.

## Unresolved questions

1. **Event-log-carried identifiers beyond `artifact.created`.** Clause 2 says "or any other event-carried occurrence" — deliberately broad. If a future event carries artifact-type identifiers under another field name, the clause covers it, but nothing enumerates such fields. Left to the events that introduce them.
2. **Should the rewrite prohibition become a SECURITY invariant?** It is a MUST-NOT, but its violation is undetectable from outside after the fact (a rewritten log looks honest), so a public test can only pin the prose — which the conformance leg already does. Filing it as an invariant would add a row without adding enforcement. Left out; revisit if replay attestation (RFC 0140's direction) ever makes violation externally observable.

## Implementation notes (non-normative)

For a migrating host, the whole job is the alias map plus the discipline of resolving it in every registration decision. The witness host's two design details worth copying: key the compiled-validator cache off the *resolved* id (both spellings share one schema, no drift), and make a dangling alias resolve to nothing rather than to a phantom registration.

Closes **G5** (RFC 0138 gap register, updated in this PR). Does not touch **G8** — the `store: true` emission leg is separate work, gated on the witness host's pending emission run.

## Acceptance criteria

- [x] Normative prose merged (`artifact-type-packs.md` §"Legacy identifiers and migration")
- [x] Conformance scenario pinning all four clauses, server-free, always-on
- [x] Reference host implements — **predates the RFC**: openwop-app#3030, source-verified, validation-path resolution sabotage-verified on the host's side
- [x] RFC 0138 gap G5 closed in its register
- [x] CHANGELOG entry; suite minor bump with the three-way pin

## References

- `spec/v1/artifact-type-packs.md` §"Legacy identifiers and migration" — the normative text
- RFC 0138 §"On the `artifactTypeId` constraint" (as corrected 2026-08-07, `7e9df023`) — the mis-derivation this RFC prevents recurring
- RFC 0140 — replay side-effect suppression; hardens the same fixed-history premise from the effects direction
- `spec/v1/replay.md` §"Determinism guarantees"; `run-event-payloads.schema.json` `$defs/artifactCreated` — the composition
- openwop-app#3030 (`c972960a`) — the witness implementation and the source of clauses 3 and 4
