# RFC 0213: three outcomes the v2 core never stated — a resume cursor past the log, the loser of a same-key race, and a resolve after the run ended

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0213                                                            |
| **Title**         | three outcomes the v2 core never stated — a resume cursor past the log, the loser of a same-key race, and a resolve after the run ended |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-23                                                      |
| **Updated**       | 2026-09-23 — filed and moved `Draft → Active` the same day; **comment window waived** by an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the public window for an RFC affecting **replay**, **idempotency** or **authorization**. §A governs event-log resumption, §B the idempotency concurrency rule, §C the resolve outcome on an approval surface — all three classes. Recorded in `MAINTAINERS.md` as an override row. The evidence gate (RFC 0147 §A.5) is not overridden: each section carries its own acceptance box and moves to `Accepted` independently on its own witness. **Acceptance is provisional and the RFC 0156 §B retrospective review is owed** (register row `not-reviewed`). |
| **Affects**       | `spec/v2/core/events.md` §SSE (one paragraph) · `spec/v2/core/idempotency.md` (Concurrency row) · `spec/v2/core/errors.md` §"One code per state" (one sentence) · `spec/v2/core/interrupt.md` (one table cell, one note) · `spec/v2/errors.json` (`interrupt_cancelled` provenance fields only) · `SECURITY/invariants.yaml` (+1) · conformance (3 new scenarios) · `COMPATIBILITY.md` §3 (two Class-3 entries) |
| **Compatibility** | Conformance-affecting corrections (W3C Process Class 3) for §A and §C; `additive` for §B (a new normative requirement on a previously undefined behavior, `COMPATIBILITY.md` §4). No new error code, no schema change, no `spec/v2/corrections.json` row |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Three v2 core rules name an outcome for the case everybody tests and say nothing about the case next to it. `events.md` tells a host to "look up the event with that sequence" on `Last-Event-ID`, and is silent when no event has it. `idempotency.md` requires that one of two concurrent same-key requests win, and is silent on what the loser receives. `errors.md` and `interrupt.md` answer a resolve against a cancelled run with `409 interrupt_already_resolved`, while the registry still carries `interrupt_cancelled` as a `410` whose provenance cites a v1 rule that actually said `422`. This RFC states each outcome the way the conforming hosts already behave, so each section is a correction or an addition that no conforming host fails.

## Motivation

Census taken 2026-09-23 at openwop `d593ad55`, openwop-app `813d69aab`, openwop-examples `f367ffa`, and MyndHyve `92f422621` (read by a MyndHyve session; `services/workflow-runtime/src`).

| Gap | openwop-app | v2-reference | sqlite / postgres / python |
| --- | --- | --- | --- |
| `Last-Event-ID` beyond the log | cursor: terminal ⇒ 200, no frames, close; live ⇒ waits for `sequence > N` | cursor | cursor |
| malformed `Last-Event-ID` | `400 invalid_request` (not in the v2 registry; projected as a vendor code) | ignored — resumes from start | ignored |
| loser of a same-key race | `409 idempotency_in_flight`; v2 hygiene strips `details.retryAfter`, so **no** `Retry-After` at all | `409` + `Retry-After: 1` | python blocks, then replays |
| resolve after cancel/complete | token surface 409; run-scoped on cancelled run `410 openwop-app.interrupt_gone` | 409 on both surfaces | — |

MyndHyve: a numeric `Last-Event-ID` past the log is an exclusive cursor (terminal ⇒ 200 and close; live ⇒ waits) — conforming to §A; a malformed id resumes from 0 (§A's SHOULD, not a MUST); under v2 a foreign tenant segment is refused `403 id_tenant_mismatch` before the cursor is read. A same-key loser receives the winner's run as a `201` (a final outcome — §B permits it) but with `OpenWOP-Idempotent-Replay: false` (already non-conforming to the existing Replay-marker row). A resolve after cancel answers `200` until an hourly reconciler closes the suspension — already non-conforming to the existing `errors.md` §"One code per state" MUST, independent of §C. MyndHyve therefore witnesses §A only.

No host emits `interrupt_cancelled`. No v2 scenario covers any of the three.

## Proposal

### §A. `Last-Event-ID` is an exclusive cursor

Replaces the first sentence of `events.md` §SSE paragraph 2:

> `Last-Event-ID: N` is an exclusive cursor with the semantics of the poll `afterSequence`: the host MUST stream the events with `sequence > N` in log order and MUST NOT re-emit `N`. When `N` is at or beyond the last persisted sequence there is no backlog: on a live run the host MUST hold the stream open for later events, and on a terminal run it MUST close the stream without a frame. A host MUST NOT refuse a well-formed non-negative integer `Last-Event-ID` because no event carries that sequence. A value that is not a non-negative integer SHOULD be refused with `400 validation_error`. The header is evaluated only after the caller is authorized to read the run: for a run the caller cannot read, the response MUST be the one the host gives without the header. (That response is `404 not_found` for an unknown or unreadable run and `403 id_tenant_mismatch` for a foreign tenant segment, `runs.md` §Identity; this RFC changes neither, it forbids the cursor from changing them.)

No error code is minted. There is no "past retention" state to name: v2 core defines no pruning of a live run's log (the only retention rule is fork-scoped, `replay.md` §Retention), and a deleted run is already `404`.

### §B. The loser of a same-key race

Replaces the `idempotency.md` Concurrency row:

> Of two concurrent same-key requests a host MUST process exactly one to completion and MUST NOT process both. The other MAY wait, bounded by the host's request timeout, and then receive the winner's response **only if that response is a final outcome** (a response this record caches); it MUST carry `OpenWOP-Idempotent-Replay: true`. Otherwise — the host does not wait, the wait times out, or the winner's outcome is retryable — the host MUST answer `409 idempotency_in_flight` with no retry timing in `details`, and SHOULD set `Retry-After`. `idempotency_in_flight`'s registry `retriable: false` means the request is not retryable *without waiting*; the caller retries after `Retry-After` or its own backoff.

`Retry-After` is SHOULD because openwop-app's v2 path sends none today; tightening it later needs its own RFC.

### §C. A resolve after the run ended — one code

Appends to `errors.md` §"One code per state":

> `interrupt_cancelled` is registered and names no state of the core resolve surfaces; a host MUST NOT emit it from `resolveInterruptByRun`, `inspectInterruptByToken` or `resolveInterruptByToken`.

`interrupt.md` resolve table, `409` row: "Already resolved, or the run is cancelled or completed (both surfaces); or a token invalidated by resolution, cancellation or completion."

`spec/v2/errors.json` `interrupt_cancelled` row: `statusSource` `"v1 prose"` → `"registry (v1 prose said 422, run-scoped; RFC 0213 §C)"`; `source` → `"spec/v1/interrupt.md:434 (422, run-scoped). v2 core resolve surfaces do not emit it — RFC 0171 C4.6 one code per state; RFC 0213 §C."` `httpStatus`, `retriable`, `details` and `since` are unchanged, and no `deprecated` marker is added (a code's meaning is not retirable in 2.x, RFC 0197 R4). `generate-error-envelope.mjs` reads neither provenance field.

## Compatibility

- **§A (Class 3).** The old text gave no instruction when the looked-up event does not exist; all five hosts in the census implement the exclusive cursor, and poll already mandates it (`events.md` §Poll: a cursor past the end returns `200` with no events). The malformed-id SHOULD refuses nothing a conforming host must accept.
- **§B (additive).** New normative requirement on a previously undefined outcome; both behaviors the census shows (block-then-replay, `409`) remain conforming. The only host behavior it excludes — handing a loser a retryable outcome — contradicts the existing "Retryable outcomes" row.
- **§C (Class 3).** Prose and registry contradicted each other; the prose wins because v2-reference follows it and no host emits the registry code. openwop-app's vendor `interrupt_gone` is non-conforming under either reading.

## Conformance

Three new scenarios, off the core-standard floor (`v2-sse-last-event-id` is a floor scenario with a committed MyndHyve pass; a new leg there would re-judge a claim against an unmeasured behavior — rc.59 precedent). Promotion to the floor is deferred until all three bundle hosts are measured.

1. **`v2-sse-last-event-id-cursor`** — fixture `conformance-delay` (exists).
   - future id on a terminal run ⇒ `200`, zero frames, server close;
   - `Last-Event-ID: abc` ⇒ records `400 validation_error` if refused, observes otherwise (SHOULD);
   - unknown run and foreign-tenant run with a cursor ⇒ the same status and `error` code as the same request without the header (`404 not_found` / `403 id_tenant_mismatch`).
   - Sabotage: `400` on a future id; resume from `0`; cursor checked before authorization (the with/without-header answers differ).
2. **`v2-idempotency-in-flight`** — v2 variant of the major-1 `highConcurrency.test.ts`; fixture `conformance-delay` with `delayMs` long enough to overlap.
   - N parallel same-key `createRun` ⇒ exactly one distinct `runId`; every other response is either a replay (`OpenWOP-Idempotent-Replay: true`, same body) or `409 idempotency_in_flight` with no `details.retryAfter*`; `Retry-After`, when present, parses.
   - Non-vacuity: if no request observed the winner in flight (all replays after completion), record `executed-pass` with `partial-witness:` detail, not a plain pass.
   - Sabotage: drop the claim (two runs); put `retryAfter` back in `details`; answer `idempotency_key_mismatch`.
3. **`v2-interrupt-resolve-terminal`** — fixture `conformance-approval`.
   - suspend → cancel → run-scoped resolve ⇒ `409 interrupt_already_resolved`; suspend → accept → completed → second resolve ⇒ same; (the signed-token surface is a SHOULD and needs a token the suite cannot mint — not re-tested here); unknown run ⇒ `404 not_found` before any terminal check.
   - Sabotage: openwop-app's current `410` vendor code; a resolve on a cancelled run answering `200`.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §A exclusive cursor | frames after a future id; close on terminal | the suite | witnessable |
| §A authz-first | same status + code with/without header, unknown run | the suite | witnessable; the foreign-tenant variant needs a second credential, else `blocked` |
| §B one winner | distinct `runId` count | the suite (concurrency) | witnessable; overlap not guaranteed ⇒ `partial-witness` |
| §B final-only handover | loser never receives a 429/5xx replay | host (needs a retryable winner) | seam-gated — recorded, not claimed |
| §B in-flight refusal under a held claim (`openwop.requirement.0213.in-flight-refused-under-hold`) | a same-key create while the seam holds the claim is `409 idempotency_in_flight`, no retry timing in `details`; the held create wins | the suite, through the seams profile (`armIdempotencyHold`, host-sample-test-seams.md §26 — the seam only arms a hold; the 409 is the host's own path) | witnessable-gated (seam) — an additional witness; the unaided `§B one winner` row keeps §B off the seam-only ratchet |
| §C one code | status of resolve after cancel | the suite | witnessable |

## Alternatives considered

- **A new `event_cursor_invalid` / `event_cursor_expired` pair.** Rejected: `400` on a future id makes all five hosts non-conforming and contradicts poll; "expired" names a state the protocol does not define.
- **Registry wins for §C (`410 interrupt_cancelled`).** Rejected: v2-reference, which follows the prose, would stop conforming; RFC 0171 C4.6 removed exactly this second spelling of one state.
- **Flip `idempotency_in_flight` to `retriable: true`.** Rejected: changes a registered code's meaning (R4).
- **Three RFCs.** Considered; one RFC with independent acceptance boxes gives the same independence with one override row.

## Acceptance criteria

- [ ] **§A** — `v2-sse-last-event-id-cursor` `executed-pass` on v2-reference and an openwop-app memory boot, with each sabotage red.
- [ ] **§B** — `v2-idempotency-in-flight` `executed-pass` (not `partial-witness`) on one host. **Seam route (2026-09-26):** `0213.in-flight-refused-under-hold` drives the 409 branch deterministically through `armIdempotencyHold` (host-sample-test-seams.md §26) on a host that mounts the seams profile — an `executed-pass` on it satisfies this box. The record is in flight only while the winning *create request* is handled, so on a host that answers create in milliseconds the `409` branch rarely runs (v2-reference 2026-09-23: 5 of 5 answers were the winner plus four marked replays — `partial-witness`). The one-winner and replay-marker legs execute there; the `409` branch needs a host whose create handling overlaps, or a seam that holds a claim.
- [ ] **§C** — `v2-interrupt-resolve-terminal` `executed-pass` on v2-reference; openwop-app ADR fix merged (run-scoped v2 ⇒ 409).
- [ ] Invariant `event-cursor-after-authorization` resolves to a test.
- [ ] RFC 0156 §B retrospective review row filed `not-reviewed`.

## References

RFC 0171 (§A, §B.2, §E; row C4.6); RFC 0170 §D.3, §E.1; RFC 0093; RFC 0197 R4; `spec/v1/idempotency.md:136`; `spec/v1/interrupt.md:434`; `spec/v1/stream-modes.md:185-191`.
