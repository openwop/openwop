# Persistence and Coexistence

> **Status: Stable · RFC 0176 (§A–§B, §D–§E), 0171 §A, 0170 §A.3, 0158 §A–§D.**
> **Normative home:** `eventLog`.

## Why this exists

How a v2 host reads what a v1 host wrote, what happens to a run in flight at the cut, and what each persisted store becomes — so two hosts read one log one way.

## The codemap is data

`spec/v2/event-codemap.json`, shipped in `@openwop/spec-artifacts`, is the only authority for the v1→v2 event-type mapping; every row is `decided` (RFC 0171 §A). A host MUST NOT carry a private mapping. A vendor-prefixed v1 type the codemap does not name MUST be read under its own name unchanged, where "vendor-prefixed" means the first segment is an org registered in the `extensions` object of `spec/v2/declaration.json` (events.md §Rules; RFC 0171 §A.1 — `openwop.` is the only reserved prefix). An unregistered first segment is not a vendor prefix and falls to the refusal below. An org is registered by pull request against the corpus and takes effect on the `@openwop/spec-artifacts` release that carries it; a shipped entry is append-only, because deregistering an org would convert every log already written under it from pass-through to refusal (RFC 0180).

## The era key

`eventLogSchemaVersion` is the era key and is required on every run snapshot (`schemas/v2/run-snapshot.schema.json`).

| Value | Meaning |
| --- | --- |
| absent | On a store a v1 host has ever written, the run MUST read as `2` (v1 era). |
| `2` | v1 era; every reader translates through the codemap. |
| `3` | v2 era; a v2 host MUST stamp `3` on every run it creates. |
| `< 2` | The v1 rule is unchanged: snapshot fallback, no projection write-through. |

Discovery MUST advertise the value the host writes for new runs and nothing else; a host MUST hold one constant for this axis.

**Absent stays era `2` forever; it is never backfilled.** A host MUST NOT rewrite
historical rows to add an explicit `2`, and a reader MUST NOT require one. A host with more than one creation
path MUST begin stamping `3` on **all** of them in the same change: an unstamped
path's runs read as era `2`, a silent wrong read.

**The snapshot field is required on the wire, and MAY be synthesized.**
For an era-`2` run with nothing stored, the host MUST supply `2` from the
absent-⇒-`2` rule rather than fail the read. The field therefore cannot falsify
era handling on its own; the reader and writer rules below carry the obligation.

## The `eventLog` family

`eventLog` is the capability record by which a host advertises the era contract
above. A host that advertises `eventLog` MUST stamp `eventLogSchemaVersion` on
every run it creates, MUST serve the cursor contract in events.md §"Poll" over
that log, and MUST NOT emit an event `type` the codemap does not name. The
record carries no separate storage claim: it asserts that the era key, the
codemap and the poll cursor are implemented as written here, which is why its
floor scenarios are the era-key and cursor witnesses rather than tests of a
surface of its own. Its `crossEngineOrdering` facet is a replay property and is
normed in replay.md §"Cross-engine ordering".

## The reader rule

A v2 host reading a run in era `2` MUST translate every event through the codemap at the storage boundary:

- `type` is mapped; the payload is projected per RFC 0171 §B.
- `sequence` MUST be preserved verbatim, including `0`.
- `eventId`, `timestamp`, `causationId`, and vendor fields pass through.
- A type the codemap does not name and that carries no reserved vendor prefix MUST fail the read with `event_type_unmapped` (`spec/v2/errors.json`, `500`). A malformed row MUST fail the read rather than default any field.

The rule binds every reader: poll, SSE, fork, replay divergence, debug bundle, summary memory. The translation is a read projection. A host MUST NOT rewrite era-`2` rows in place; a background backfill that stamps `3` and rewrites `type` under the same `(runId, sequence)` key is permitted only as an atomic per-run operation with the original preserved, because the fork prefix must stay byte-equivalent to the translated parent (replay.md, RFC 0041 §C).

### The writer rule

The era key is fixed when the run is created and fixes the log's vocabulary for
the run's lifetime. An append to a run in era `2` MUST use v1 vocabulary — the
name the codemap maps *from*, not the v2 name it maps to. A host that upgrades
mid-flight MUST NOT begin writing v2 names into a log the reader translates as
era `2`: the reader would map an already-mapped name a second time, or fail the
read with `event_type_unmapped` on a name the codemap does not carry on its v1
side. A run created after the upgrade is era `3` and is written in v2
vocabulary, untranslated.

A writer that emits a property a closed def cannot seat (RFC 0185 §B) MUST
mark the row with what it could not seat, so the refusal names the writer
instead of surfacing as an unexplained read failure (RFC 0187 §D.1).

This binds every writer for as long as an era-`2` run stays open (§"Runs pinned
to v1"); its witness is `v2-era-2-append-vocabulary`.

### The v1 wire of an era-`3` log

Through the overlap (`versioning.md` §5) an era-`3` log, stored in v2
vocabulary, must still read on `/v1/…` exactly as before the cut.

A host serving both majors MUST therefore map an era-`3` log's `type` back to
its v1 spelling on the v1 read path, through the **same codemap row, inverted**.
The inverse is exact only while `spec/v2/event-codemap.json` is a bijection; a
host MUST verify that at load and, if a row folds two v1 names onto one v2 name,
MUST refuse to serve the v1 representation rather than guess a spelling.

A type with NO codemap row — v2-only vocabulary, anything RFC 0185/0186 seated
— has no v1 spelling to invert to. A host MUST emit it unchanged on the v1 read
path, MUST NOT drop the row, and MUST NOT refuse the read for it (RFC 0187
§B.1).

### The seat

The adapter MUST sit at the storage boundary every reader passes through — the storage interface's event-list method, not a wrapper some call sites bypass. A host leg MUST name its seat in its ADR.

The seat is a **claims-check** (conformance.md §Witness class): discharged by that disclosure and by audit, never by the wire. The rule binds **every** reader, including the ones the suite has no name for; `run-event.schema.json` records why three passing legs do not discharge it.

## Runs pinned to v1

A non-terminal run a v2 host inherits carries `version.pinned` events naming change ids. The host MUST continue it or cancel it, never follow a pin silently.

| Condition | Requirement |
| --- | --- |
| Every pinned change id is still implemented | The run MUST continue under the reader rule; the pin is honored verbatim and `version.pinned` is never rewritten. |
| Any pinned change id is no longer implemented | The host MUST cancel the run with `run.cancelled` reason `v1_pin_unsupported` and `cancelledBy: "v2-cutover"`; the certification bundle reports the count. |
| Suspended on an interrupt at the cut | The run continues under the row above; its token drains per §"Everything else a v1 host persisted". |

"Drain" is retired as the only path. Multi-region skew is read-side only: after the cut a v2 region MUST NOT accept an era-`2` write for a run it has already stamped `3` (RFC 0176 §B.3). Discovery's `minClientVersion` rule is RFC 0172 row `C5.8`.

## Everything else a v1 host persisted

| Artifact | Requirement |
| --- | --- |
| Certification bundles | Never upgraded. A v1 bundle substantiates no new certification after 2026-11-10; every host produces a fresh v2-rc bundle before the cut (conformance.md). |
| Webhook deliveries | Dual-emitted, and queued deliveries drained, per webhooks.md §"Dual emission through the overlap". |
| Interrupt resume tokens | Drained: a token that is **not** `ow2.`-prefixed is a v1 token and resolves under `kid: legacy` until `expiresAt`; new tokens carry the `ow2.` prefix (identity.md). The rule is written over the prefix, never a segment count. |
| Layer-1 and Layer-2 records (idempotency, idempotent responses, invocation claims and logs, effect-escape ledger, dispatch outbox, envelope correlations) | Unchanged; keyed on ids the cut does not rename. `GET /runs/{runId}/effects` and `GET /runs/{runId}/compensation` are new reads over them (security-defaults.md). |
| Owner stamps | A run without a Subject MUST be legacy-stamped at first v2 read and MUST NOT be rewritten later (RFC 0170 §A.3). A host's stored owner fields are projected to the Subject; the projection is the host's to name. |
| Audit log | Never upgraded (RFC 0170). |

## Per-store disposition

A host's ADR MUST name every store it persists and give each one disposition from the closed set below.

| Disposition | Meaning |
| --- | --- |
| `unchanged` | Rows keep their shape and keys; a v2 reader consumes them as they are. |
| `translated` | Rows are read through the codemap at the storage boundary; never rewritten in place except the atomic per-run backfill. |
| `drained` | Rows complete under their own v1 contract until exhausted or expired; no new rows of the v1 shape are written. |
| `legacy-stamped` | A missing v2 field is given its legacy value at first v2 read and never rewritten. |
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

The reference hosts' dispositions are recorded in RFC 0176; a host MUST NOT decide a store's disposition during the migration.

## Durable acceptance and recovery

RFC 0158 §A–§D.

| Clause | Requirement |
| --- | --- |
| Acceptance (§A) | A host that returns success for work it accepted MUST have made the intent to perform it durable in the same transaction as the work record; a wakeup, hint, or in-process dispatch MUST NOT be the only record. It MUST resume accepted-but-unstarted work after the accepting process dies, without client action. |
| Liveness (§B.3) | A host MUST distinguish how long a unit of work may legitimately run from the interval in which a live worker demonstrates liveness, and MUST NOT use the duration bound as the sole liveness signal. |
| Recovery bound (§B.4–6) | A host MUST declare the longest interval between an instance ceasing to make progress and another becoming eligible to resume its work, and MUST derive it from the mechanism that enforces it — one bound per enforcing mechanism, never a single aggregate. Any length is conformant; an undeclared or unenforced bound is not. |
| Duplicates (§C.7) | Duplicate delivery of accepted work MUST NOT produce duplicate external effects; the host MUST dedupe on an identity that survives redelivery (idempotency.md). |
| Poison work (§C.8) | Work that fails deterministically MUST reach a terminal, operator-visible state within a bounded number of attempts. |

A host MAY claim a qualification rung (`durable-single-instance`, `durable-multi-instance`, `multi-region-qualified`; cumulative) only with the evidence named for it, and MUST NOT claim one from tests in which no process was terminated (§D.9). A rung is evidence, not a capability: discovery carries none, and the rung and its bounds are published in the certification bundle (conformance.md §Bundle v3).

See also: overview.md, events.md, replay.md, identity.md, webhooks.md.
