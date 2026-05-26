# RFC 0054: Run diff & execution comparison

| Field | Value |
|---|---|
| **RFC** | 0054 |
| **Title** | A read-only `GET /v1/runs/{runId}:diff?against={otherRunId}` endpoint returning a deterministic, replay-aware structured diff of two runs' event sequences and terminal states — the protocol surface behind run-vs-fork comparison |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-26 (Draft → Active — the full wire surface landed atomically on `main` via PR #108 (`schemas/run-diff-response.schema.json` + the `GET /v1/runs/{runId}:diff` OpenAPI path + `rest-endpoints.md` §:diff prose + `sdk/typescript` `runs.diff()` + `RunDiffResponse` + `conformance/src/scenarios/run-diff.test.ts` + reference-host endpoint), but the Status was left `Draft`; this promotion reflects that completion. The three Unresolved questions are resolved below; UQ3's exclusion list is now pinned normatively in `rest-endpoints.md` §:diff. `Active → Accepted` awaits a non-steward host advertising the endpoint + passing the identical + fork-divergence scenarios.) |
| **Affects** | `spec/v1/rest-endpoints.md` (new read endpoint) · `api/` OpenAPI (additive path) · `schemas/run-diff-response.schema.json` (new) · `spec/v1/replay.md` (aligns with `replay.diverged` / determinism) · RFC 0011 (fork) composition · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add a read-only endpoint, `GET /v1/runs/{runId}:diff?against={otherRunId}`, that returns a deterministic, replay-aware structured diff of two runs (typically a run and its RFC 0011 fork): `{ divergedAtSeq, eventDiffs[], stateDiff }`. The diff is a pure function of the two event logs, aligning with the determinism guarantees and the `replay.diverged` event in `spec/v1/replay.md`. This gives MyndHyve's workflow studio (and any host's time-travel debugging UI) a portable, certifiable comparison surface instead of host-private diffing.

## Motivation

MyndHyve's workflow studio and debugging flows want to **compare two runs** — most often an original vs a forked replay (the "execution diffing" gap from the analysis). RFC 0011 fork creates a new run, and `spec/v1/replay.md` already emits a `replay.diverged { originalEventId, replayEventId, divergencePoint }` event when a replay fork diverges — but there is **no endpoint** to retrieve a structured diff of two event logs / terminal states. So any comparison UI is host-private and uncertifiable, and an A2A peer or external tool can't request "how do these two runs differ?".

The spec is the right place because the diff must be **deterministic and replay-aware**: two conformant hosts asked to diff the same pair of event logs must return the same `divergedAtSeq`. That is an interop guarantee that builds directly on the determinism contract already in `replay.md` — not an implementation choice.

## Proposal

### §A — Endpoint (additive, in `rest-endpoints.md` + OpenAPI)

Mirrors the corpus `:verb` action-endpoint convention (`POST /v1/runs/{runId}:fork`, `:pause`):

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `GET` | `/v1/runs/{runId}:diff?against={otherRunId}` | API key | `runs:read` | Structured diff of two runs |

`runs:read` on **both** runs is required (a caller lacking read on `against` gets `run_forbidden`, composing with RFC 0048 cross-workspace isolation). Both runs MUST be terminal (or the host MAY diff in-flight prefixes and mark `truncated: true`).

### §B — `run-diff-response.schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/schemas/run-diff-response.schema.json",
  "title": "RunDiffResponse",
  "type": "object",
  "required": ["a", "b", "eventDiffs", "stateDiff"],
  "properties": {
    "a": { "type": "string", "description": "The {runId} run." },
    "b": { "type": "string", "description": "The {against} run." },
    "divergedAtSeq": { "type": ["integer", "null"], "minimum": 0, "description": "Event sequence number at which the two logs first diverge; null if identical. Aligns with `replay.diverged.divergencePoint`." },
    "eventDiffs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["seq", "op"],
        "properties": {
          "seq": { "type": "integer", "minimum": 0 },
          "op": { "type": "string", "enum": ["added", "removed", "changed"] },
          "aEvent": { "type": "object" },
          "bEvent": { "type": "object" }
        },
        "additionalProperties": false
      }
    },
    "stateDiff": { "type": "object", "description": "Diff of terminal RunSnapshot states (status, variables, channels) — redaction-safe." },
    "truncated": { "type": "boolean", "description": "True if either run was in-flight and only a prefix was compared." }
  },
  "additionalProperties": false
}
```

### §C — Determinism (normative)

The diff MUST be a **pure function** of the two runs' event logs: given the same two logs, every conformant host returns the same `divergedAtSeq` and the same ordered `eventDiffs`. Sequence alignment is by event `seq`; the first `seq` whose event differs (by canonical comparison, excluding non-deterministic transport metadata like wall-clock receipt time) sets `divergedAtSeq`. Identical logs ⇒ `divergedAtSeq: null` and empty `eventDiffs`. This aligns with the determinism scoring + `replay.diverged` contract in `spec/v1/replay.md`.

## Compatibility

**Additive.** New read-only endpoint; new response schema; no change to any existing endpoint or event. Hosts that don't implement it return `404` for the path (or omit it from their OpenAPI); clients discover support via the capability/endpoint manifest. No existing conformance pass is invalidated.

**Depends on RFC 0011** (fork — the primary source of a run pair to diff). Independent of Tiers 1–2.

## Conformance

- **`run-diff-identical.test.ts`** — diffing a run against itself (or an identical replay) ⇒ `divergedAtSeq: null`, empty `eventDiffs`. (Gated on the endpoint being advertised.)
- **`run-diff-fork-divergence.test.ts`** — fork a run, force divergence after seq N ⇒ `divergedAtSeq === N`; `eventDiffs` start at N. (Gated on endpoint ∧ fork support.)
- **`run-diff-state-shape.test.ts`** — `stateDiff` reflects terminal-state differences (status/variables) and is redaction-safe. (Gated.)
- **`run-diff-authz.test.ts`** — a caller lacking `runs:read` on `against` gets `run_forbidden`. (Gated; composes with RFC 0048.)

New fixture: a base run + a deterministically-divergent fork, catalogued in `fixtures.md`.

## Alternatives considered

1. **Path-style `GET /v1/runs/{a}/diff/{b}`.** Rejected for consistency — the corpus uses the `:verb` action convention (`:fork`, `:pause`); a query-param `against` keeps `{runId}` the primary resource and matches the existing style. (Noted as the original proposal in `plans/myndhyve-protocol-extension-rfcs.md`.)
2. **Emit the diff as an event rather than a read endpoint.** Rejected — a diff is a derived, on-demand query over two existing logs, not a run-lifecycle fact; an event would force the host to compute and persist diffs nobody requested.
3. **Leave diffing to clients (return raw event logs, let the UI diff).** Rejected — without a normative, deterministic `divergedAtSeq`, two tools would disagree on where runs diverged, and the comparison wouldn't be certifiable or portable.

## Unresolved questions

1. **Cross-host diff.** Can `against` reference a run on a *different* host (federated diff)? Out of scope for v1 (both runs are same-host); revisit with A2A if pulled.
2. **Semantic vs structural event comparison.** Should `changed` distinguish "same event, different payload" from "different event type"? The `op` enum is coarse; a richer classification may be wanted. Start coarse; refine if the studio UX needs it.
3. **Which metadata is excluded from comparison.** §C excludes "non-deterministic transport metadata" — the exact exclusion list (event ids? timestamps?) must be pinned against `replay.md`'s determinism caveats before Active.

### Resolution (2026-05-26, at Active promotion)

1. **Cross-host diff** → **resolved: out of scope for v1.** Both runs are same-host; `against` resolves on the receiving host. Federated/A2A diff is deferred (revisit only if A2A demand surfaces). No wire change reserved — a future cross-host variant would be additive.
2. **Coarse `op` enum** → **resolved: keep coarse (`added`/`removed`/`changed`) for v1.** A richer per-field classification is a backward-compatible refinement (additional optional fields on the `eventDiffs[]` item) if the studio UX needs it; the coarse enum is sufficient for the run-vs-fork comparison this RFC targets.
3. **Excluded-metadata list** → **resolved + pinned normatively.** The comparison key is `(seq, type, JCS(payload-minus-excluded))`; the excluded set — `eventId`, `runId`, `causationId`, `correlationId`, wall-clock `ts`, and transport metadata (`traceparent`, delivery headers) — is now enumerated in [`rest-endpoints.md`](../spec/v1/rest-endpoints.md) §"`GET /v1/runs/{runId}:diff`" (run-scoped/non-deterministic fields that would otherwise make every cross-run diff report total divergence). Run-scoped ids carried in the observable payload for replay (`memoryId`, `childRunId`) are compared as-is — re-minting them is a genuine divergence.

## Implementation notes (non-normative)

- Endpoint + schema (§A, §B) land on `Active` promotion with the conformance scenarios; the OpenAPI path is added under `api/`.
- Reference-adopter target: MyndHyve's workflow studio renders the diff for run-vs-fork comparison and feeds its time-travel debugging UI.

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] Endpoint in `spec/v1/rest-endpoints.md` + the `api/` OpenAPI path (`diffRun`).
- [x] `run-diff-response.schema.json` added (+ listed in `schemas/README.md`).
- [x] Determinism contract aligned with `spec/v1/replay.md` (excluded-field list pinned in `rest-endpoints.md` §:diff).
- [x] Four conformance scenarios (identical, fork-divergence, state-shape, authz/access-boundary) in `conformance/src/scenarios/run-diff.test.ts` + `coverage.md` row.
- [x] CHANGELOG entry.
- [x] TS SDK: `OpenwopClient` `runs.diff()` + `RunDiffResponse` type.
- [ ] A non-steward host implements the endpoint and passes identical + fork-divergence. **(Path to `Accepted`.)**

## References

- [`RFCS/0011-auth-scoped-discovery.md`](./0011-auth-scoped-discovery.md) — fork (the primary source of a diffable run pair).
- [`spec/v1/replay.md`](../spec/v1/replay.md) — the `replay.diverged` event + determinism contract `divergedAtSeq` aligns with.
- [`spec/v1/rest-endpoints.md`](../spec/v1/rest-endpoints.md) — the `:verb` endpoint convention this mirrors.
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — cross-workspace read isolation the authz scenario composes with.
