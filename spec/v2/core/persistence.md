# Persistence and Coexistence

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0176 (§A–§B, §D–§E), 0171 §A, 0170 §A.3.**

## Why this exists

The v2 cut renames event types that are persisted, indexed, and unique-keyed in production stores, and fork and replay read those rows verbatim. This document states how a v2 host reads what a v1 host wrote, what happens to a run in flight at the cut, and what each persisted store becomes — so two hosts read one log one way.

## The codemap is data

`spec/v2/event-codemap.json`, shipped in `@openwop/spec-artifacts`, is the only authority for the v1→v2 event-type mapping; every row is `decided` (RFC 0171 §A). A host MUST NOT carry a private mapping. A vendor-prefixed v1 type the codemap does not name MUST be read under its own name unchanged (RFC 0171 §A.2 reserved-prefix rule).

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
historical rows to add an explicit `2`, and a reader MUST NOT require one. The
trichotomy is sound only because a v2 host stamps `3` on *every* run it creates:
if any creation path is left unstamped after the cut, the runs it makes are
indistinguishable from pre-cut runs and every reader will translate them as era
`2` — a silent wrong read, not an error. So a host with more than one creation
path MUST begin stamping `3` on **all** of them in the same change; staging that
across deploys is the failure this rule exists to prevent.

**Collapsing to one constant is a precondition for advertising, not a
consequence.** A host whose creation paths disagree — one writing `2`, another
writing nothing — has no single value to advertise, and whatever it publishes is
false for some of its own runs. Unify the writers first, then advertise. This is
the same class of constraint as the writer rule below and is ordered the same
way: the store is made coherent before the wire describes it.

**The snapshot field is required on the wire, and MAY be synthesized.**
`schemas/v2/run-snapshot.schema.json` requires `eventLogSchemaVersion`, but an
era-`2` run predates the key and has nothing stored. The snapshot is a read
projection, so the host MUST supply `2` from the absent-⇒-`2` rule rather than
fail the read; a missing *stored* era is not a read error. The consequence is
worth stating plainly: on the wire this field is never absent, so it cannot
falsify a host's era handling on its own. What falsifies that is the vocabulary
of the events themselves, which is why the reader and writer rules below carry
the obligation and this field only reports it.

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

This binds every writer for as long as an era-`2` run stays open, which on a
host with human-approval interrupts can be days. Draining era-`2` runs before
serving v2 is not the path — see §"Runs pinned to v1" — so the writer rule is
what makes an in-flight run safe across the cut. Its witness is
`v2-era-2-append-vocabulary`.

### The v1 wire of an era-`3` log

The reader rule above is written for a v2 reader of an era-`2` log. Through the
overlap a host serves BOTH majors (`versioning.md` §5) and v1 operations keep
their `/v1/…` path keys unchanged (§1.2), so the mirror case is forced and the
corpus owed it a rule: a run created today is era `3` and its log is stored in
v2 vocabulary, yet the same log must still be readable on `/v1/…` exactly as it
was before the cut.

A host serving both majors MUST therefore map an era-`3` log's `type` back to
its v1 spelling on the v1 read path, through the **same codemap row, inverted**.
This is well defined and not a private mapping: `spec/v2/event-codemap.json` is
a bijection — 118 rows, 118 distinct `v1` names, 118 distinct `v2` names, no
many-to-one fold — so the inverse of a row is exact. A host MUST verify that
property at load rather than assume it; if a future row folds two v1 names onto
one v2 name, the inverse stops being a function and the host MUST refuse to
serve the v1 representation rather than guess which spelling to emit.

Two alternatives are rejected, and naming them is the point of this section.
Storing v1 spellings under an era-`3` stamp makes the stamp a lie, and the
closed-enum scenario would pass it by luck on any run whose types happen to be
identity rows. Serving v2 names on `/v1/…` breaks the v1 wire, which the
overlap exists to preserve. Neither is a smaller change than the inverse map;
they are the same change with the honesty removed.

### The seat

The adapter MUST sit at the storage boundary every reader passes through — the storage interface's event-list method, not a wrapper some call sites bypass. A host leg MUST name its seat in its ADR; the `v1-events-translated` scenario reads through poll, SSE, and a fork so a wrapper-only adapter is caught (conformance.md).

### Forking a v1 run

A fork of an era-`2` run MUST produce a prefix byte-equivalent to the translated parent, and its `run.started` MUST carry the legacy Subject where the parent had none (RFC 0176 §A.5; replay.md, identity.md).

## Runs pinned to v1

A non-terminal run a v2 host inherits carries `version.pinned` events naming change ids. The host MUST continue it or cancel it, never follow a pin silently.

| Condition | Requirement |
| --- | --- |
| Every pinned change id is still implemented | The run MUST continue under the reader rule; the pin is honored verbatim and `version.pinned` is never rewritten. |
| Any pinned change id is no longer implemented | The host MUST cancel the run with `run.cancelled` reason `v1_pin_unsupported` and `cancelledBy: "v2-cutover"`; the certification bundle reports the count. |
| Suspended on an interrupt at the cut | The run continues under the row above; its outstanding token is resolvable under `kid: legacy` until `expiresAt` (RFC 0170 §E.1), and the run reads through the adapter. |

"Drain" is retired as the only path. Multi-region skew is read-side only: after the cut a v2 region MUST NOT accept an era-`2` write for a run it has already stamped `3` (RFC 0176 §B.3). Discovery's `minClientVersion` rule is RFC 0172 row `C5.8`.

## Everything else a v1 host persisted

| Artifact | Requirement |
| --- | --- |
| Certification bundles | Never upgraded. A v1 bundle substantiates no new certification after 2026-11-10; every host produces a fresh v2-rc bundle before the cut (conformance.md). |
| Webhook deliveries | A host advertising both majors MUST dual-emit the `X-openwop-*` and `OpenWOP-*` header families through the overlap; a v2 receiver MUST accept a v1-signed delivery (`X-openwop-*`, scheme `v1`) verifying the same bytes; per-subscription secrets are unchanged; deliveries queued before the cut are drained under their own retry policy with the payload they were serialized with (webhooks.md). |
| Interrupt resume tokens | Drained: v1 two-segment tokens resolve under `kid: legacy` until `expiresAt`; new tokens carry the `ow2.` prefix (identity.md). |
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
| interrupts | two-segment tokens | `drained` |
| webhook subscriptions and queued deliveries | subscriptions; serialized deliveries | `unchanged`; `drained` |
| idempotency, invocation, outbox, correlation tables | keyed records | `unchanged` |
| audit log | audit facts | `never-upgraded` |
| certification bundles | v1 bundles | `never-upgraded` |
| host-internal tables | outside the wire | `unchanged` |

The reference hosts' dispositions are recorded in RFC 0176; a host MUST NOT decide a store's disposition during the migration.

## The corpus-tag pin

A consumer that vendors any file from `schemas/`, `api/`, or `spec/` MUST pin to a published `openwop-conformance/vX.Y.Z` tag, MUST record the tag, and MUST refuse a sync from any other ref. A v1.x consumer MUST NOT vendor `schemas/v2/` (RFC 0176 §E.1). The `corpus-tag-pinned` check verifies that each consumer's recorded tag resolves (conformance.md).

See also: overview.md, events.md, replay.md, identity.md, webhooks.md.
