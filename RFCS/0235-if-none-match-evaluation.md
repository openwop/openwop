# RFC 0235: `If-None-Match` is evaluated as HTTP defines it

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0235                                                            |
| **Title**         | `If-None-Match` is evaluated as HTTP defines it                 |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-04                                                      |
| **Updated**       | 2026-10-05 — **`Active → Accepted`, provisional pending the RFC 0156 §B retrospective review** (STEWARD OVERRIDE of RFC 0147 §A.6, register row `not-reviewed`). Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host: its certified public cut on published suite 2.45.18 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`; build `commit:e5f27708`, witness `63e5201ddef1`, signed `v2-reference-4`, 497 pass / 0 fail / 0 blocked, every claimed profile certified, egress guard closed, nothing relaxed; openwop-examples #152–#154) records the four `openwop.requirement.0235.*` ids `executed-pass`. Gaps G1 and G2 are closed on that cut, so no row carries to itself. · 2026-10-04 — `Draft` → `Active`, comment window waived by the maintainer (2026-10-04: "skip the comment window and move it to Active"), recorded as a STEWARD OVERRIDE of RFC 0147 §A.6 in MAINTAINERS.md. §A and §B are merged; the §D legs ship in suite 2.45.18, proven against a double and against the v2 reference host before and after openwop-examples #152. · 2026-10-04 — filed `Draft` after an `/architect` ruling (2026-10-04) on what "matching the `ETag`" means. The 7-day comment window opens with the pull request and closes 2026-10-11. |
| **Affects**       | `spec/v2/core/runs.md` §Caching and encoding · `spec/v2/core/capabilities.md` §1.1 · the `If-None-Match` parameter and the discovery `ETag` header in `api/v2/openapi.yaml` (through `scripts/derive-v2-api.py`), and so `spec/v2/core/headers.md` · `v2-discovery-etag.test.ts`, `v2-run-snapshot-etag.test.ts` |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.4, §2.3): no field, status code or endpoint changes. It binds an undefined word to the RFC 9110 meaning the corpus already cites; a host that compared byte-exact keeps its recorded measurements and fails only the new legs of a later suite. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The v2 corpus says a request whose `If-None-Match` "matches" the `ETag` MUST receive `304`, on the discovery document and on the run snapshot, but never says what matching is. The three matrix hosts read it three ways: MyndHyve implements RFC 9110 §13.1.2, openwop-app implements most of it, and the v2 reference host compares the header byte-for-byte. This RFC binds the word to RFC 9110: `*` or a list of entity tags, compared weakly. It adds the two RFC 9110 rules a host can get wrong on its own: a condition is evaluated only when the unconditional answer would be `2xx`, and a request `Cache-Control: no-cache` does not suppress it.

## Motivation

**The word is undefined, and the hosts disagree.** `runs.md` §Caching and encoding: "a request whose `If-None-Match` matches it MUST receive `304`". `capabilities.md` §1.1: "MUST honor `If-None-Match` with `304`". `headers.md` (generated from OpenAPI): "A value matching the `ETag` the host sent". What the hosts do (source, 2026-10-04):

| Host | Discovery | Run snapshot |
| --- | --- | --- |
| MyndHyve (`v2Mount.ts` `ifNoneMatchMatches`) | RFC 9110: `*`, list, weak | same helper |
| openwop-app (`restTransport.ts` `ifNoneMatchSatisfied`) | `*`, list, `W/` stripped from the request side | same helper |
| v2 reference (`server.ts`, `runs.ts`) | list, exact members, no `*`, no `W/` | `header === etag` |

Read literally, "a value matching" admits the byte-exact reading, so the reference host is conformant today. A client using standard HTTP machinery is not served by it.

**Weak comparison is what survives an intermediary.** A compressing proxy commonly rewrites a strong `"x"` to `W/"x"`, because the compressed bytes are a different representation. The client echoes `W/"x"`; a byte-exact origin answers `200` on every poll. RFC 9110 §13.1.2 makes `If-None-Match` use weak comparison for exactly this reason. openwop-app's public origin already sits behind a CDN edge whose conditional behaviour cost a release cycle (2.45.17).

**A `304` must not become an existence oracle.** `*` matches whenever a current representation exists. A host that evaluated it before deciding the caller may read a run would answer `304` where it owes the non-disclosure `404` ([identity.md](../spec/v2/core/identity.md)). All three hosts load the readable run first today, but nothing in the corpus requires it. RFC 9110 §13.2.1 does: a server evaluates preconditions only when the response would otherwise be `2xx` or `412`.

**One origin already lost every `304` to `Cache-Control: no-cache`.** MyndHyve's discovery route records (`v2Mount.ts`) that Express's `req.fresh` ignores `If-None-Match` when the request carries `Cache-Control: no-cache`, and fetch-based clients send it, so no such client got a `304`. That directive governs caches; an origin validates regardless.

## Proposal

### §A. The rule

`runs.md` §Caching and encoding replaces its `304` bullet with:

> A host evaluates `If-None-Match` as RFC 9110 §13.1.2 defines it: the value `*`, or a list of entity tags any of which matches the current `ETag` under weak comparison (the `W/` prefix is ignored on either side).
>
> - On a match the host MUST answer `304` with no body, carrying the `ETag` and the `Vary` the `200` would carry.
> - The host MUST evaluate `If-None-Match` only when the unconditional response would be `2xx`. A run the caller cannot read stays `404`, whatever the request carries.
> - A request `Cache-Control: no-cache` MUST NOT suppress the evaluation.

The same bullet's first line drops "strong": "The `200` SHOULD carry an `ETag` derived from the latest persisted `sequence`". The `gzip` rule two lines down lets the same tag serve two content codings, which a strong validator may not (RFC 9110 §8.8.3). Weak comparison makes the difference harmless for `If-None-Match`.

### §B. The other sites point at §A

1. `capabilities.md` §1.1: "MUST honor `If-None-Match` with `304`" becomes "MUST honor `If-None-Match` with `304` (runs.md §Caching and encoding)", the citation written as a link in the doc.
2. The `If-None-Match` parameter description in `api/v2/openapi.yaml` (both operations), and so `headers.md`: "A value that matches the current `ETag` (runs.md §Caching and encoding) MUST yield `304 Not Modified` with no body."
3. The discovery `ETag` response header: "Strong validator" becomes "Validator", matching `capabilities.md`'s "standard `ETag`".

### §C. Scope

- The two operations that declare `If-None-Match` today: `GET /.well-known/openwop` and `GET /runs/{runId}`. An operation that declares it later inherits §A by the citation.
- `If-Match` (workspace writes, `host-services.md`) is untouched. RFC 9110 gives it strong comparison, and nothing here changes that.
- v1 is frozen ([RFC 0234](./0234-maintainer-set-v1-end-of-support.md)) and gets no edit.

### §D. Conformance

`v2-discovery-etag` and `v2-run-snapshot-etag` gain the legs below through one shared observe/judge library (the per-major witness pattern), so both surfaces judge alike. "The tag" is the `ETag` of the preceding `200`.

1. **weak** — `If-None-Match: W/<tag>` → `304`.
2. **list** — `If-None-Match: "openwop-conformance-no-such-tag", <tag>` → `304`.
3. **star** — `If-None-Match: *` → `304` on discovery, and on a run the caller can read.
4. **not-2xx** — `*`, and separately a tag the host minted for a readable run, on a run id that does not exist → the unconditional status (`404`), never `304`.
5. **negatives** — a list of non-matching tags, and `W/"openwop-conformance-no-such-tag"` → `200`.
6. **304-carries-etag** — every `304` above carries an `ETag` equal to the tag.
7. **no-cache** — `<tag>` with `Cache-Control: no-cache` → `304`.

Gating is unchanged: discovery always (the `ETag` is a MUST there), the snapshot only when its `200` carries an `ETag`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A `*` and a list match; comparison is weak — `openwop.requirement.0235.if-none-match.rfc9110-match` | `304` to `W/<tag>`, to a list holding the tag and to `*`; `200` to non-matching lists and weak tags (§D 1–3, 5) | the suite, unaided | witnessable — executed-pass required on a host bundle |
| §A a `304` carries the `ETag` — `openwop.requirement.0235.if-none-match.304-carries-etag` | the `304`'s `ETag` header equals the tag (§D 6) | the suite, unaided | witnessable — executed-pass required on a host bundle |
| §A evaluation only where the answer would be `2xx` — `openwop.requirement.0235.if-none-match.only-on-2xx` | `404`, not `304`, to `*` and to a minted tag on an absent run (§D 4) | the suite, unaided | witnessable — executed-pass required on a host bundle |
| §A `Cache-Control: no-cache` does not suppress evaluation — `openwop.requirement.0235.if-none-match.no-cache-ignored` | `304` to a matching tag sent with `no-cache` (§D 7) | the suite, unaided | witnessable — executed-pass required on a host bundle |
| §A the `304` carries the `Vary` the `200` would carry | header comparison with the preceding `200`; a host whose `200` sends no `Vary` makes it vacuous | the suite, unaided | witnessable — unaided (asserted inside the 304-carries-etag leg, not a requirement of its own) |

## Compatibility

`additive`.

- No schema, field, status code, error code or endpoint changes. The OpenAPI edits are description text.
- `headers.md` already says standard headers keep their standard names, and its `ETag` row cites RFC 9110. This RFC makes the standard meaning of the conditional explicit rather than introducing a new one.
- Under COMPATIBILITY.md §2.3 a host's recorded passes stand. A byte-exact host fails §D 1–3 on the first suite that ships them, and fixes it by adopting RFC 9110 evaluation.
- Clients are unaffected: a client sending its last tag verbatim gets the same `304` as before.

## Alternatives considered

1. **Byte-exact matching, made explicit.** Simplest to implement and to witness. Rejected: it fails every client behind a compressing intermediary, and contradicts the RFC 9110 semantics a standard header name promises.
2. **Strong comparison.** Rejected: RFC 9110 reserves strong comparison for `If-Match` and range requests. For `If-None-Match` it would turn intermediary weakening into a cache miss on every poll.
3. **Leave it to each operation.** Rejected: the two surfaces would drift, as the reference host's two comparisons already have.
4. **Edit only the conformance legs.** Rejected: COMPATIBILITY.md §2.3 forbids a suite stricter than the spec about the wire, and the byte-exact reading is a defensible reading of today's text.

## Unresolved questions

None. Proof surfaced one fact the legs rely on: Node's fetch adds `Cache-Control: no-cache` to every request carrying `If-None-Match`, so a host that skips evaluation on it (Express `req.fresh`) fails every `304` leg, not only §D 7. An `/architect` review (2026-10-04) decided the rule (§A), its home (`runs.md`, cited from the other sites; the kernel budget has room for it) and the legs (§D).

## Implementation notes (non-normative)

- **v2 reference host** (`openwop-examples`): one helper for both comparisons, replacing `header === etag` in `runs.ts` and the exact-member list in `server.ts`. Every helper of this shape is about six lines (MyndHyve's `ifNoneMatchMatches` is a model).
- **openwop-app**: strips `W/` from the request side only. It passes §D while it emits strong tags.
- **Sequencing.** Draft → Active with the prose and OpenAPI edits; the legs and their scratch-host proof in the same suite release; the reference host adopts the helper (openwop-examples #152) and re-cuts.

## Acceptance criteria

- [x] `Active`: the comment window was waived on the record (maintainer, 2026-10-04; MAINTAINERS.md) with §A unchanged in substance.
- [x] §A and §B merged; `derive-v2-api.py --write` regenerates `headers.md`; `CHANGELOG.md` records it.
- [x] §D legs ship in suite 2.45.18 (`lib/if-none-match-witness.ts`), each failing on its sabotage in the self-test double: byte-exact, no list, no `*`, strong-only, a `304` without `ETag` or `Vary`, `no-cache` skipping, always-`304`, and `*` evaluated before the readability check. Against the v2 reference host: `rfc9110-match` failed before openwop-examples #152 and all ten legs pass after it; a `*` `304` before `loadRun` and a `304` without `ETag` each fail their leg.
- [x] `Accepted`: a certified major-2 bundle records the four `openwop.requirement.0235.*` ids `executed-pass`. *(2026-10-05: the v2 reference host's certified public cut on published suite 2.45.18, build `commit:e5f27708`. The criterion as filed also said "with no test seams served". That host serves the conformance seams profile, but none of the four legs calls a seam: each is a plain `GET` with `If-None-Match`, so the seams cannot have produced the result. The wording is corrected here rather than met by a different host.)*

## References

- RFC 9110 §8.8.3 (entity tags; weak and strong comparison), §13.1.2 (`If-None-Match`), §13.2.1 (when preconditions are evaluated), §15.4.5 (`304`).
- `spec/v2/core/runs.md` §Caching and encoding; `spec/v2/core/capabilities.md` §1.1; `spec/v2/core/headers.md`; `spec/v2/core/identity.md` (non-disclosure `404`).
- RFC 0115 (run transport economy: the conditional run read), RFC 0165 §C.2 (the discovery `ETag`), RFC 0170 (which owns `openwop.requirement.0170.run-snapshot-etag`), RFC 0234 (the frozen v1 tree).
- `conformance/src/scenarios/v2-discovery-etag.test.ts`, `v2-run-snapshot-etag.test.ts`; 2.45.17 release notes (the CDN-edge cause).
- Registers: [`gaps`](./registers/0235-if-none-match-evaluation.gaps.md), [`risks`](./registers/0235-if-none-match-evaluation.risks.md).
