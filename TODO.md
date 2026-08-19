# TODO — shared working state

> **What this file is.** A handoff note between parallel Claude Code sessions working on this
> corpus, and for the maintainer returning to it. It records **what is in flight, what is blocked
> on whom, and what has already been done** — the last one because a stale board is how two
> sessions spend two machines on the same task.
>
> **Last updated:** 2026-08-19, at `main` after the RFC 0162 wedge-hazard entry.
> Keep it short. Delete finished items rather than accumulating a changelog — `CHANGELOG.md` is
> the changelog.

## Working agreements between sessions

- **Never work in the shared checkout** (`/Users/david/dev/openwop`). `git worktree add ../openwop-<task> origin/main`. See `CLAUDE.md`.
- **Two channels reach the corpus session** — the `agrade` crosstalk queue and SendMessage. **RFC 0162 substance goes on SendMessage; the queue is coordination.** When an item listed on the queue is finished over SendMessage, **post the completion to the queue too.** The board is only as current as its least-connected channel; this failed once already today, with a second session verifying preconditions for a drive that had already been run.
- **A host's own test is evidence about that host, not a witness of the wire.** Nothing enters `INTEROP-MATRIX.md` as suite-witnessed without a suite run, and `committed` is not `promoted` — a row waits for the revision that actually serves.
- **Claim work out loud before starting.** The window between "a peer starts" and "a peer opens a PR" is invisible, and it has cost a duplicated implementation.

## In flight

| item | owner | state |
|---|---|---|
| RFC 0162 host half — rung `durable-single-instance`, per-class recovery bound | openwop-app | `recoveryBound.ts` is per-class (`declaredRecoveryBoundMs(cls)`, class required, no collapsed form). **`unleased` derived but NOT published** pending measurement — the outbox lane may own that path (~65 s, not 150 s), and a number that bounds reality while deriving from a mechanism that never touches the work fails `bound-is-derived` on its own terms. |
| Sweeper wedge fix + re-run of the durability exercise | openwop-app | Fix is per-lane re-entry guards + wall-clock cadence + per-lane deadline, sabotage-verified both directions. The 12.5-minute leased measurement is **still unmeasured** — the first attempt measured a mechanism that may have been wedged. |
| The kill/dispatch-hold seam contract for RFC 0162's recovery rows | **undecided — needs a joint call** | Four of six rows need a real process termination. Options: a self-terminating `/v1/host/sample/*` seam under `OPENWOP_CONFORMANCE_FIXTURES`; operator-run evidence in the bundle (re-opens the "host's own test" gap closed for fan-out); or split tiers. Corpus half is the steward's; the seam shape is the host's. |

## Blocked, and on what

- **`SECURITY/threat-model-replay.md` invariant for a future fan-out row** — nothing pending; the model and `replay-fanout-no-refire` are landed. Listed only so nobody re-derives it.
- **MyndHyve webhook header fixes** (`sha256=` prefix, `X-openwop-Webhook-Id`) — committed, **not promoted**. Matrix stays silent until they name the serving revision.
- **RFC 0162 rows other than `poison-exhaustion`** — blocked on the seam decision above. **Do not write them**; the corpus half is claimed.
- **The "dossier" RFCs 0158/0160/0161/0163/0164** — they do not exist in this corpus and 0162 records 0159 as folded into RFC 0150 §D. **Not being authored.** If they are wanted, the dossier has to reach the steward; nobody should infer them.

## On the maintainer's desk (not any session's to decide)

- **RFC 0147 §A.1 "essential" carve-out (D2).** Declined five times by the corpus session, most recently when a conformance-only test seam looked like it needed one — it did not, because `host-sample-test-seams.md` already puts seams outside the v1 wire surface. That ruling is **not precedent for D2**.
- RFC 0154 proof format · hosted-CI billing · maintainer and audit recruitment.

## Standing debt with a number on it

- **Threat-model traceability: 79 of 184 invariants** point at a document that never names them. Ratcheted in `check-security-invariants.sh` — it may not grow, and the gate asks you to lower the baseline when you trace one. Lowering it is the work.
- **`partial-witness:` rows.** `resolveFileRecord` now retains a discarded soft-skip note as a `detail` marker instead of dropping it. 75 `softSkip` calls sit after a first assertion across 36 files — a count of *positions*, not of wrong rows. **The next conformance bundle turns that into a measured number**, which is what should size the per-`it` recording fix. Do not build the durable fix before reading it.
