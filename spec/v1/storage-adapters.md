# OpenWOP Spec v1 — Storage Adapters

> **Status: Stable · v1.1 (2026-04-29).** Comprehensive coverage of the two normative storage-adapter contracts (`RunEventLogIO` and `SuspendIO`) that any OpenWOP-compliant engine implementation MUST satisfy. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

The openwop runtime needs durable storage for two state surfaces:

1. **Event log** — append-only sequence of `RunEventDoc` per run. Source of truth for the projected `RunSnapshot`. Consumers (UI, CLI, conformance suite) subscribe to the live tail; replay tools fold history.
2. **Suspension state** — durable per-suspension records that survive process restarts so HITL approvals + external-event waits can resume cross-session.

Concrete deployments choose their own backing store. Worked examples include in-memory storage for tests, SQLite for portable single-node deployments, Postgres for self-hosted distributed runtimes, and cloud-native document stores for managed hosts. The spec specifies the contracts that any such backend MUST satisfy so engines stay storage-agnostic. This document defines the two contracts and points at illustrative reference-host patterns.

---

## Contract 1 — `RunEventLogIO`

The event-log persistence contract. Implementations MUST persist append-only events keyed on `(runId, sequence)` with monotonic sequence assignment per run.

### Methods

```typescript
interface RunEventLogIO {
  /**
   * Atomically append an event to a run's log. Implementation MUST:
   *   1. Read the current max sequence (per-run scoped).
   *   2. Assign sequence = max + 1 (or 0 if log is empty).
   *   3. Persist the event with the assigned sequence.
   *   4. Return the persisted doc.
   *
   * Concurrent appends to the same run MUST yield distinct sequences.
   * On Firestore: wrap in `runTransaction`. On Postgres: serializable
   * transaction OR `INSERT ... RETURNING sequence` over a per-run sequence.
   */
  appendAtomic(runId: string, event: RunEventDocInput): Promise<RunEventDoc>;

  /**
   * Read events in sequence order. `fromSequence` is INCLUSIVE
   * (default 0). `limit` defaults to 100; implementations MAY clamp
   * higher limits.
   */
  read(
    runId: string,
    opts?: { fromSequence?: number; limit?: number },
  ): Promise<RunEventDoc[]>;

  /**
   * Get the most-recently-appended event for a run. Returns null if no
   * events exist. Used by replay tools for `fromSeq` bounds checks.
   */
  getLatest(runId: string): Promise<RunEventDoc | null>;

  /**
   * Subscribe to events from `fromSequence` (inclusive). Returns an
   * unsubscribe function. Backends use Firestore `onSnapshot`,
   * Postgres LISTEN/NOTIFY, or polling — the contract surface is
   * agnostic. Implementation MUST normalize timestamps to JS `Date`
   * before invoking `onEvent`.
   *
   * Backfill: subscribers MUST receive events at or after
   * `fromSequence` already in the log BEFORE any live appends. Mirrors
   * Firestore's onSnapshot initial-snapshot behavior.
   */
  subscribe(
    runId: string,
    fromSequence: number,
    onEvent: (event: RunEventDoc) => void,
    onError: (err: Error) => void,
  ): () => void;
}
```

### Reference implementations (non-normative)

The example hosts ship two reference implementations (in-memory + SQLite). Both are illustrative — third-party hosts MAY ship their own.

| Implementation       | Use                                                                              | Module                                |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| `InMemoryEventLogIO` | Tests + reference deployments without durability                                 | Reference-host implementation pattern |
| `SqliteEventLogIO`   | Durable single-node reference impl; zero-install on Node 22.5+ via `node:sqlite` | Reference-host implementation pattern |

The contract surface above is the normative part and is reusable for any backend. The SQLite adapter is **Node-only** (browser bundlers cannot resolve `node:sqlite`) and should live under a dedicated sub-path so it does not pollute browser-safe surfaces.

---

## Contract 2 — `SuspendIO`

The suspension-state persistence contract. Implementations MUST persist pending suspensions keyed on `suspensionId` and surface them for cross-process resume.

### Methods

```typescript
interface SuspendIO {
  /** Create a new pending suspension doc. */
  createPending(doc: PendingDoc): Promise<void>;

  /** Read the current state of a suspension. Returns null if missing. */
  read(suspensionId: string): Promise<PendingDoc | null>;

  /** Patch a suspension to resumed/rejected/timed-out status. */
  update(suspensionId: string, patch: Partial<PendingDoc>): Promise<void>;

  /**
   * Subscribe to changes on a suspension doc. Callback fires whenever
   * the doc updates. Returns an unsubscribe fn. Implementation MUST
   * deliver the current state as the initial snapshot, then live
   * updates as they arrive. Mirrors Firestore's onSnapshot.
   */
  watch(
    suspensionId: string,
    cb: (doc: PendingDoc | null) => void,
  ): () => void;

  /**
   * Return pending suspensions matching the filter. Used by the
   * SuspendManager's rehydration on startup. Implementations MUST
   * apply `status == 'pending'` automatically and honor `cardTypes`,
   * `runIds`, `ownerUserId`, `limit` filters at the storage layer
   * rather than post-filtering in JS (cost + perf).
   */
  query(filter: SuspendQueryFilter): Promise<PendingDoc[]>;
}
```

### Doc shape

`PendingDoc` (alias for `FirestorePendingDoc` for back-compat):

```typescript
interface PendingDoc {
  suspensionId: string;
  runId: string;
  nodeId: string;
  reason: PendingSuspension['reason'];
  status: 'pending' | 'resumed' | 'rejected' | 'timed-out';
  createdAt: string;          // ISO 8601
  expiresAt?: string;
  resumedAt?: string;
  resumeValue?: unknown;
  rejectReason?: unknown;
  prompt?: PendingSuspension['prompt'];
  cardType?: string;
  timeoutMs?: number;
  ownerUserId?: string;       // Optional; rehydration filter
  projectId?: string;         // Optional; surface filter
}
```

### Reference implementations (non-normative)

| Implementation      | Use                                                                                                                       | Module                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `InMemorySuspendIO` | Tests + reference deployments without durability                                                                          | Reference-host implementation pattern |
| `SqliteSuspendIO`   | Durable single-node reference impl; zero-install on Node 22.5+ via `node:sqlite`; polling-based `watch()` (100ms default) | Reference-host implementation pattern |

---

## Claim acquisition

> **Added 2026-08-18 (SP-04).** Four artifacts have cited `storage-adapters.md` §"Claim acquisition" since RFC 0009 — `production-profile.md` §Durability ("Storage adapters MUST satisfy `storage-adapters.md` lease and event-log invariants, including stale-claim recovery"), RFC 0009's scenario-citation table, and the docstrings of `staleClaim.test.ts` and `restart-during-run.test.ts` — and the section did not exist. The contract below is the one the SQLite reference host and the tier-1 host already implement and the one those two scenarios already assert; writing it down resolves the citations rather than introducing a new requirement.

A host that runs more than one process against shared storage MUST NOT execute a
run in two processes at once, and MUST NOT strand a run whose executing process
died. Both follow from one mechanism: an expiring **claim** (a lease) on the run,
renewed while the holder executes.

This section is normative for hosts advertising `capabilities.production.supported: true`
(`production-profile.md` §Durability). A single-process host with no shared storage
cannot violate it and need not implement it.

### The claim record

A run MUST carry a claim holder identity and a claim expiry:

| Field | Requirement |
| --- | --- |
| holder id | The process/instance identity currently executing the run. `null` (or absent) when unclaimed. |
| expiry | The wall-clock instant after which the claim is **stale** and MAY be taken by another process. `null` (or absent) when unclaimed. |

The field names are the adapter's own — the reference SQLite adapter uses
`runs.claim_holder_id` / `runs.claim_expires_at`. What is normative is that both
facts are durable and are read and written in the same store as the run, so a
process that cannot see the run cannot claim it either.

### Acquisition

Acquiring a claim MUST be **atomic** — a single compare-and-set against the
durable store, not a read followed by a write. The condition is "unclaimed OR
expired":

```sql
-- The reference SQLite adapter (examples/hosts/sqlite/src/server.ts), verbatim in shape:
UPDATE runs SET claim_holder_id = ?, claim_expires_at = ?
  WHERE run_id = ?
    AND (claim_holder_id IS NULL OR claim_expires_at < ?)
```

A host MUST treat "zero rows affected" as **lost the race** and MUST NOT execute
the run. Two processes MUST NOT both conclude they hold the claim: a read-then-write
acquisition permits exactly that interleaving and is not conformant, however
short the window.

### Heartbeat and TTL

While executing, the holder MUST renew its own claim's expiry at an interval
strictly shorter than the TTL, so a live holder never appears stale. The
reference adapter defaults to a `30s` TTL renewed every `10s`; the conformance
scenario drives `2s` / `500ms`. Neither number is normative — the **ratio** is:
renewal interval MUST be less than the TTL, with enough margin to survive a
scheduling delay or a slow store round-trip.

Renewal MUST be scoped to the holder (`WHERE claim_holder_id = <me>`), so a
process whose claim was already stolen cannot extend a claim it no longer holds.

The TTL is the bound on how long a run stays stranded after a process dies, so a
host SHOULD make it configurable and SHOULD document its default.

### Stale reclaim

A claim whose expiry has passed is **stale**. Another process MAY acquire it
through the same atomic acquisition above — no separate "steal" path, and no
coordination with the dead holder, which by definition cannot participate.

A host MUST NOT reclaim a claim that has not expired, even when the holder looks
unhealthy by some other signal. Expiry is the only reclaim authority; adding a
second one reintroduces the double-execution the claim exists to prevent.

### Resume on startup

On boot, a host MUST look for runs that are non-terminal and unclaimed-or-stale,
and MUST attempt to claim and resume them. Without this, a run whose only
executing process died stays stranded until some unrelated request happens to
touch it — the run is durable, and stalled, which is the failure
`production-profile.md` §Durability exists to exclude.

Resume MUST go through the same atomic acquisition: a booting process races other
live processes, and losing the race is the correct outcome, not an error.

### Event-log invariants under claim transfer

A claim transfer MUST NOT perturb the run's event log:

- The log is append-only across the transfer. The resuming process MUST NOT
  rewrite, renumber, or truncate events the previous holder appended.
- Sequence numbers MUST remain monotonic across the transfer — the resuming
  process continues the sequence, it does not restart it.
- A transfer is not itself a run event. Claim churn is host-operational state;
  emitting it into the run's log would make replay depend on which process
  executed, which `replay.md` forbids.
- The terminal-event rule holds regardless of which process appends it
  (`observability.md` §"Run lifecycle events", including the durability boundary:
  a terminal status MUST NOT be reported before its terminal event is appended).

### Conformance

`staleClaim.test.ts` and `restart-during-run.test.ts` assert this contract across
two real processes over shared storage: process A starts a run and is `SIGKILL`ed
without releasing its claim; after the TTL elapses, process B boots against the
same store, resumes the run through resume-on-startup, and the run reaches a
terminal status observable on B's HTTP surface — with A's events intact and the
sequence continuous.

Both are `@multi-process` and `@timing-sensitive`: they spawn hosts and depend on
a configurable TTL, so they are opt-in (`OPENWOP_RUN_STALE_CLAIM=1`, with
`OPENWOP_STALE_CLAIM_HOST_DIR` naming a host package that exposes
`OPENWOP_CLAIM_TTL_MS` / `OPENWOP_HEARTBEAT_INTERVAL_MS`). A host advertising
`capabilities.production.supported: true` SHOULD run them; they are the only
executing witness of this section.

---

## Naming and back-compat

The original v1 type + class names carried a `Firestore-` prefix because Firestore was the only initial implementation:

- `FirestoreSuspendIO` (interface)
- `FirestorePendingDoc` (doc shape)
- `FirestoreSuspendManager` (durable manager class)

Post-v1 adopts host-agnostic names:

- `SuspendIO`
- `PendingDoc`
- `DurableSuspendManager`

The original prefixed names remain exported as type aliases (and a class alias for `FirestoreSuspendManager` → `DurableSuspendManager`) for back-compat. New consumer code SHOULD prefer the unprefixed names; existing imports of the prefixed names continue to resolve to the same types/class.

The event-log contract `RunEventLogIO` was already host-agnostic in v1 — no rename needed.

---

## Compliance checklist

A storage adapter implementation MUST:

- [ ] Yield distinct sequences for concurrent `appendAtomic` calls within the same run (event log).
- [ ] Apply per-run sequence isolation (different runs have independent counters).
- [ ] Filter by `fromSequence` inclusively in `read` and `subscribe`.
- [ ] Default `read` limit to 100 events.
- [ ] Deliver the historical tail before live appends in `subscribe` (event log) and the current state as the first watch callback (suspend).
- [ ] Honor `query` filter combinations at the storage layer (suspend).
- [ ] Apply `status == 'pending'` filter automatically in `query` (suspend).

A storage adapter SHOULD:

- [ ] Provide a `clear()` test helper.
- [ ] Provide a `size()` test helper.
- [ ] Tolerate subscriber-callback exceptions without crashing the storage layer.

---

## Future work

- **Postgres reference implementation** — `pg`-backed adapter as a durable example for distributed deployments. SQLite covers self-hosted single-instance deployments; Postgres adds the distributed-write story (LISTEN/NOTIFY for change feeds, multi-writer concurrency).
- **SQLite reference implementation** — `SqliteEventLogIO` + `SqliteSuspendIO` demonstrate the single-node durable pattern. Zero-install on Node 22.5+ via the built-in `node:sqlite` module.
- **Adapter compliance suite** — shared vitest test suite that any third-party adapter can run to verify spec compliance. The in-memory adapter tests
  (`InMemoryEventLogIO.test.ts`, `InMemorySuspendIO.test.ts`) are the prototypes for this; extracting them into a parameterized harness is post-v1 ecosystem work.

---

## See also

- `auth.md` — API key + scope vocabulary
- `replay.md` — uses `RunEventLogIO.read({fromSequence, limit})` for fork-fold
- `interrupt.md` — uses `SuspendIO` for HITL persistence
- `version-negotiation.md` — `RunEventDoc.engineVersion` is part of the contract
- `examples/hosts/in-memory/` — no-durability reference host.
- `examples/hosts/sqlite/` — durable single-node reference host.
