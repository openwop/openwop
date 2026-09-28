# Persistence and Coexistence

> **Status: Stable.**
> **Normative home:** `eventLog`.

## Why this exists

How a v2 host reads what a v1 host wrote, what happens to a run in flight at the cut, and what each persisted store becomes — so two hosts read one log one way.

## The codemap is data

`spec/v2/event-codemap.json`, shipped in `@openwop/spec-artifacts`, is the only authority for the v1→v2 event-type mapping. Every row is `decided`.

- A host MUST NOT carry a private mapping.
- A vendor-prefixed v1 type the codemap does not name MUST be read under its own name, unchanged.
- "Vendor-prefixed" means the first segment is an org registered in the `extensions` object of `spec/v2/declaration.json` ([events.md §Rules](events.md)). `openwop.` is the only reserved prefix. An unregistered first segment is not a vendor prefix and falls to the refusal in §"The reader rule".
- An org is registered by pull request against the corpus and takes effect on the `@openwop/spec-artifacts` release that carries it. A shipped entry is append-only: deregistering an org would turn every log already written under it from pass-through into refusal.

## The era key

`eventLogSchemaVersion` is the era key. It is required on every run snapshot (`schemas/v2/run-snapshot.schema.json`).

| Value | Meaning |
| --- | --- |
| absent | On a store a v1 host has ever written, the run MUST read as `2` (v1 era). |
| `2` | v1 era; every reader translates through the codemap. |
| `3` | v2 era; a v2 host MUST stamp `3` on every run it creates. |
| `< 2` | The v1 rule is unchanged: snapshot fallback, no projection write-through. |

Discovery MUST advertise the value the host writes for new runs and nothing else; a host MUST hold one constant for this axis.

Absent stays era `2` forever; it is never backfilled.

- A host MUST NOT rewrite historical rows to add an explicit `2`, and a reader MUST NOT require one.
- A host with more than one creation path MUST begin stamping `3` on all of them in the same change. An unstamped path's runs read as era `2` — a silent wrong read.

The snapshot field is required on the wire, and MAY be synthesized: for an era-`2` run with nothing stored, the host MUST supply `2` from the absent-⇒-`2` rule rather than fail the read. The field alone therefore cannot falsify era handling; the reader and writer rules carry the obligation.

## The `eventLog` family

`eventLog` is the capability record by which a host advertises the era contract above. A host that advertises `eventLog`:

- MUST stamp `eventLogSchemaVersion` on every run it creates;
- MUST serve the cursor contract of [events.md §"Poll"](events.md) over that log;
- MUST NOT emit an event `type` the codemap does not name.

The record carries no separate storage claim: it asserts that the era key, the codemap and the poll cursor are implemented as written here. Its `crossEngineOrdering` facet is a replay property, specified in [replay.md §"Cross-engine ordering"](replay.md).

## The reader rule

A v2 host reading a run in era `2` MUST translate every event through the codemap at the storage boundary:

- `type` is mapped, and the payload projected with it.
- `sequence` MUST be preserved verbatim, including `0`.
- `eventId`, `timestamp`, `causationId`, and vendor fields pass through.
- A type the codemap does not name and that carries no reserved vendor prefix MUST fail the read with `event_type_unmapped` (`spec/v2/errors.json`, `500`).
- A malformed row MUST fail the read rather than default any field.

The rule binds every reader: poll, SSE, fork, replay divergence, debug bundle, summary memory.

The translation is a read projection. A host MUST NOT rewrite era-`2` rows in place. The one exception is a background backfill that stamps `3` and rewrites `type` under the same `(runId, sequence)` key: it is permitted only as an atomic per-run operation with the original preserved, because the fork prefix must stay byte-equivalent to the translated parent ([replay.md](replay.md)).

### The writer rule

The era key is fixed when the run is created and fixes the log's vocabulary for the run's lifetime.

- An append to a run in era `2` MUST use v1 vocabulary — the name the codemap maps *from*, not the v2 name it maps to.
- A host that upgrades mid-flight MUST NOT begin writing v2 names into a log the reader translates as era `2`. The reader would map an already-mapped name a second time, or fail with `event_type_unmapped` on a name absent from the codemap's v1 side.
- A run created after the upgrade is era `3` and is written in v2 vocabulary, untranslated.
- A writer that emits a property a closed def cannot seat MUST mark the row with what it could not seat, so the refusal names the writer instead of surfacing as an unexplained read failure.

This binds every writer for as long as an era-`2` run stays open (§"Runs pinned to v1"). Its witness is `v2-era-2-append-vocabulary`.

### The v1 wire of an era-`3` log

Through the overlap ([versioning.md §5](versioning.md)), an era-`3` log, stored in v2 vocabulary, must still read on `/v1/…` exactly as before the cut. A host serving both majors:

- MUST map an era-`3` log's `type` back to its v1 spelling on the v1 read path, through the same codemap row, inverted.
- MUST verify at load that `spec/v2/event-codemap.json` is a bijection, since only then is the inverse exact. If a row folds two v1 names onto one v2 name, the host MUST refuse to serve the v1 representation rather than guess a spelling.
- MUST emit a type with no codemap row (v2-only vocabulary, which has no v1 spelling) unchanged on the v1 read path, MUST NOT drop the row, and MUST NOT refuse the read for it.

### The seat

- The adapter MUST sit at the storage boundary every reader passes through — the storage interface's event-list method, not a wrapper some call sites bypass.
- A host leg MUST name its seat in its ADR.

The seat is a claims-check ([conformance.md §Witness class](conformance.md)): it is discharged by that disclosure and by audit, never by the wire. It binds every reader, including ones the suite has no name for; `run-event.schema.json` records why passing legs do not discharge it.

## Runs pinned to v1

A non-terminal run a v2 host inherits carries `version.pinned` events naming change ids. The host MUST continue it or cancel it, never follow a pin silently.

- **Every pinned change id is still implemented** — the run MUST continue under the reader rule. The pin is honored verbatim and `version.pinned` is never rewritten.
- **Any pinned change id is no longer implemented** — the host MUST cancel the run with `run.cancelled` reason `v1_pin_unsupported` and `cancelledBy: "v2-cutover"`. The certification bundle reports the count.
- **Suspended on an interrupt at the cut** — the run continues under the rules above; its token drains per §"Everything else a v1 host persisted".

Multi-region skew is read-side only: after the cut, a v2 region MUST NOT accept an era-`2` write for a run it has already stamped `3`. Discovery's `minClientVersion` rule is in [versioning.md §1.5](versioning.md).

## Everything else a v1 host persisted

- **Certification bundles** — never upgraded. A v1 bundle substantiates no new certification after 2026-11-10; every host produces a fresh v2-rc bundle before the cut ([conformance.md](conformance.md)).
- **Webhook deliveries** — dual-emitted, and queued deliveries drained, per [webhooks.md §"Dual emission through the overlap"](webhooks.md).
- **Interrupt resume tokens** — drained. A token that is not `ow2.`-prefixed is a v1 token and resolves under `kid: legacy` until `expiresAt`; new tokens carry the `ow2.` prefix ([identity.md](identity.md)). The rule is written over the prefix, never a segment count.
- **Layer-1 and Layer-2 records** (idempotency, idempotent responses, invocation claims and logs, effect-escape ledger, dispatch outbox, envelope correlations) — unchanged; keyed on ids the cut does not rename. `GET /runs/{runId}/effects` and `GET /runs/{runId}/compensation` are new reads over them ([security-defaults.md](security-defaults.md)).
- **Owner stamps** — a run without a Subject MUST be legacy-stamped at first v2 read and MUST NOT be rewritten later. A host's stored owner fields are projected to the Subject; the projection is the host's to name.
- **Audit log** — never upgraded.

## Per-store disposition

A host's ADR MUST name every store it persists and give each one disposition from the closed set below. A host MUST NOT decide a store's disposition during the migration.

| Disposition | Meaning |
| --- | --- |
| `unchanged` | Rows keep their shape and keys; a v2 reader consumes them as they are. |
| `translated` | Read through the codemap at the storage boundary; rewritten in place only by the atomic per-run backfill. |
| `drained` | Rows complete under their own v1 contract until exhausted or expired; no new v1-shaped rows are written. |
| `legacy-stamped` | A missing v2 field gets its legacy value at first v2 read and is never rewritten. |
| `never-upgraded` | Rows remain v1 evidence only; v2 evidence is produced fresh. |
| `not-persisted` | Nothing to migrate. |

Template — one row per store:

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| events | v1 vocabulary; `UNIQUE (runId, sequence)` | `translated` |
| runs | no `eventLogSchemaVersion`; owner fields | `legacy-stamped` |
| interrupts | un-prefixed (v1) tokens | `drained` |
| webhook subscriptions and queued deliveries | subscriptions; serialized deliveries | `unchanged`; `drained` |
| idempotency, invocation, outbox, correlation tables | keyed records | `unchanged` |
| audit log | audit facts | `never-upgraded` |
| certification bundles | v1 bundles | `never-upgraded` |
| host-internal tables | outside the wire | `unchanged` |

## Durable acceptance and recovery

- **Acceptance** — a host that returns success for work it accepted MUST have made the intent to perform it durable in the same transaction as the work record. A wakeup, hint, or in-process dispatch MUST NOT be the only record. The host MUST resume accepted-but-unstarted work after the accepting process dies, without client action.
- **Liveness** — a host MUST distinguish how long a unit of work may legitimately run from the interval in which a live worker demonstrates liveness, and MUST NOT use the duration bound as the sole liveness signal.
- **Recovery bound** — a host MUST declare the longest interval between an instance ceasing to make progress and another becoming eligible to resume its work. It MUST derive the bound from the mechanism that enforces it: one bound per enforcing mechanism, never a single aggregate. Any length is conformant; an undeclared or unenforced bound is not.
- **Duplicates** — duplicate delivery of accepted work MUST NOT produce duplicate external effects. The host MUST dedupe on an identity that survives redelivery ([idempotency.md](idempotency.md)).
- **Poison work** — work that fails deterministically MUST reach a terminal, operator-visible state within a bounded number of attempts.

A host MAY claim a qualification rung (`durable-single-instance`, `durable-multi-instance`, `multi-region-qualified`; cumulative) only with the evidence [RFC 0158 §D](https://github.com/openwop/openwop/blob/main/RFCS/0158-durable-execution-and-disaster-recovery-qualification.md) names for it, and MUST NOT claim one from tests in which no process was terminated. A rung is evidence, not a capability: discovery carries none, and the certification bundle publishes the rung and its bounds ([conformance.md §Bundle v3](conformance.md)).

See also: [overview.md](overview.md), [events.md](events.md), [replay.md](replay.md), [identity.md](identity.md), [webhooks.md](webhooks.md).

*Sources: RFCs 0041, 0158, 0170, 0171, 0172, 0176, 0180, 0185, 0186, 0187.*
