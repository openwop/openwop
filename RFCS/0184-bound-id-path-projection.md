# RFC 0184: a tenant-bound id cannot survive a front door as `%2F`

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0184                                                            |
| **Title**         | A tenant-bound id cannot survive a front door as `%2F`          |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-16                                                      |
| **Updated**       | 2026-09-16                                                      |
| **Affects**       | `spec/v2/core/identity.md` §5, `schemas/v2/ids.schema.json` (five tenant-bound kinds, `tenantId`, `$comment`), `conformance/src/lib/bound-id.ts`, `conformance/src/scenarios/v2-bound-id-path-projection.test.ts` |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1) — a new accepted spelling beside the existing one, five grammars WIDENED, one erratum to a doc table that contradicted its own schema; nothing accepted today stops being accepted |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A tenant-bound id is two segments joined by `/` (`<tenantId>/<opaque>`). A URL path parameter is one segment. Something has to carry the separator across, and `identity.md` §5 said percent-encoding: `tenant%2Fopaque`. **That spelling is not survivable through deployed infrastructure.** This RFC defines a total `~`-escape projection, makes it the form a host emits, keeps the percent form accepted, and forbids minting an id containing the escape marker. It also repairs two places where the id grammars already contradicted themselves — both found while writing the projection, neither caused by it.

## Motivation

### The measurement

`conformance/src/scenarios/v2-created-run-readable.test.ts` records it in the corpus already. On 2026-09-05, on a tier-1 host through its public origin: a run created at `https://app.openwop.dev` under major 2 could not be read, polled, cancelled or streamed at `https://app.openwop.dev`. The hosting layer decoded the bound id's `%2F` to `/` before forwarding; the backend correctly had no route for a literal slash. **Every bound id was unreachable through the host's own front door**, and every bound-id scenario recorded `blocked`. One hop behind, the direct service URL answered every read 200.

The host fixed its front door. The protocol's exposure did not change: the next host to put a CDN in front of a conformant backend hits the same wall, and the spec gives it no spelling that works.

### Why `%2F` is the wrong instrument, not just an unlucky one

This is not "an intermediary had a bug." Handling `%2F` correctly requires a front door to distinguish two cases that look identical:

- a percent-encoded **reserved** octet, which RFC 3986 §6.2.2.2 says a normalizer MUST NOT decode, because decoding changes what the path *means*;
- a percent-encoded **unreserved** octet, which it SHOULD decode, because the two spellings are equivalent.

Telling those apart means knowing the reserved set and applying it per-octet during normalization. Deployed front doors do not, and a protocol that only works when they do is a protocol with a latent outage in it.

`~` asks nothing of anyone. RFC 3986 §2.3 lists it as **unreserved**: an intermediary has no license to rewrite it in either direction, so `~2F` arrives byte-for-byte at the origin. The projection's output is drawn entirely from the unreserved set, which is the property the conformance scenario asserts before it blames a host for a 404 — `encodeURIComponent(projected) === projected`, i.e. there is nothing left to decode away.

### Why the codec is total rather than conditional

An obvious cheaper design is to escape only the separator, or to escape only when the id contains something dangerous. Both were rejected, for the same reason: **a conditional encoding is unambiguous only while the grammar holds still, and this grammar has already moved.** §A.3 below widens five patterns to admit `anon:`. A total codec — every byte outside `[A-Za-z0-9._-]` escaped, unconditionally — cannot be invalidated by a later widening, because it never asked what the grammar was.

A separator-substitution design (`/` → `.` or `:`) was rejected outright: both characters are legal inside ids, so `a.b/c` and `a/b.c` collide onto one string.

## Proposal

### §A.1 The projection (normative)

**Encode.** UTF-8 the id. Emit each byte verbatim if it is in `[A-Za-z0-9._-]`; otherwise emit `~` followed by **two uppercase hex digits**. So `/` → `~2F`, `:` → `~3A`, `~` → `~7E`.

**Decode.** Replace every `~HH` with the byte it names; accept lower-case hex on input. A `~` not followed by two hex digits is `400 validation_error`. A decoded byte sequence that is not valid UTF-8 is `400 validation_error`.

**Obligations.** A host MUST accept the projection on every tenant-bound path parameter, and MUST emit it in every link it returns. A host MUST **also** still accept the percent-encoded form — that spelling is released behaviour and withdrawing it would be breaking; this RFC adds a spelling, it does not retire one.

The codec is the identity on an already-passthrough string. A peer host measured its live corpus at 0/800 `runId` and 0/44 `subscriptionId` values containing any out-of-set character in the opaque segment, so in practice the only byte the projection changes is the separator itself.

### §A.2 Minting (normative)

A host MUST NOT mint a tenant-bound id containing `~`. Ids already minted MUST still resolve.

**Why this is needed and why it is cheap.** The codec is injective over *its own output*, because it escapes its own marker. It is not injective over arbitrary input: an **unprojected** legacy segment carrying a literal `~` decodes to something else. The mint rule closes that going forward, and the legacy clause is satisfiable because these are the host's **own** ids — it can resolve them from its own store.

That last point is the distinction this RFC turns on, and it is the same one that killed my own §A.4a in RFC 0180: a reader cannot be asked to resolve host-local history it does not have. Here it is not being asked to. The ids are its own.

### §A.5 Apply exactly once (normative, added after host review)

**A host MUST apply the projection exactly once, where an id leaves the host, and MUST NOT re-encode an id read back from its own output.**

The codec is **not idempotent**: `a~3Ab` encodes to `a~7E3Ab`. That is required — escaping the marker is what makes the function injective — but it means a second application silently corrupts, and **nothing about a correctly-projected id marks it as already projected**.

Both reporting hosts raised this independently, and neither was speculating:

- one projects payloads on both the era-3 write path and the era-2 read path, and observed that the only thing preventing a double-encode is that the two are mutually exclusive by era — *"an accident of my design rather than something the rule protects"*;
- the other already composes **two** payload projections in a single major-2 read function, and found it only because a first draft wrote them as two `payload:` keys where the second silently won.

So the invariant is stated on the **value**, not the call site. *"Call it once"* is unenforceable because nobody can see the whole call graph; *"project where an id leaves the host, never re-encode your own output"* is checkable in review. That framing is the second host's, and it is better than the one I would have written.

**It is witnessed**, not merely asserted: a double-projected segment MUST 404, so a host that projects twice strands its own links and the scenario says so.

### §A.6 Scope — what is NOT projected

- **`nodeId` and the other author-minted kinds.** They carry no tenant segment and `nodeId` already admits `:` by design. Projecting them would change ids that are legal today — the exact cost base64url was rejected for. Named because a rule about "ids" invites exactly that generalisation.
- **`Idempotency-Key`** (`idempotency.md` §Layer 1, `^[A-Za-z0-9._~-]{22,128}$`). Caller-supplied and **tilde-legal**. It is not an id kind, §5 does not bind it, nothing changes. Recorded because *"escape `~` in identifiers"* is the sentence a later reader applies to it.
- **Length.** The `{16,128}` bounds govern the **id**, never the projected segment — a bound id is already up to 257 characters before any byte escapes. A host validating the projected segment against an id pattern is checking the wrong string. Raised as "the ceiling can be crossed"; the answer is that the ceiling was never on this string.

### §A.3 The tenant segment already contradicted itself (erratum, widening)

`ids.schema.json` `tenantId` admits an optional `anon:` prefix. All five tenant-bound kinds — `runId`, `interruptId`, `subscriptionId`, `deliveryId`, `effectId` — spelled their tenant segment `[A-Za-z0-9._~-]{1,128}`, which does **not** admit `:`.

**So every runId an anon-tenant host minted was schema-invalid**, and the `tenantId` description asserted the opposite in prose: "`:` is a legal path character (RFC 3986 pchar), so this stays safe inside the `<tenantId>/<opaque>` run-id form." It was not safe. It was never checked.

This is not hypothetical. `conformance/src/scenarios/test-seam-unauthenticated.test.ts` records a reporting host whose auth "ran and succeeded, minting `tenantId: "anon:<sid>"`".

The five patterns are widened to `^(anon:)?[A-Za-z0-9._~-]{1,128}/…` to match the kind they reference. Widening is additive; nothing valid today becomes invalid.

**A second error is recorded but NOT fixed here.** `tenantId`'s rationale attributes the prefix to RFC 0132 — "RFC 0132 anonymous tenants are `anon:<hash>`". RFC 0132 has no anonymous tenants. It puts `anon:` on the **principal**, and §C.1 requires the host to resolve a real `tenant` (the surface's owner): `{tenant: "acme", principal: "anon:sess-3f9c"}`, which is exactly what `anonymous-actor-shape.test.ts` validates. Whether `anon:` belongs on a tenant at all is therefore an open question — but that grammar shipped in v2.0.0, and **narrowing it is a major-version change, not an erratum**. The false citation is corrected in place; the affordance stays. Deferred to v3.

### §A.4 The `typeId` table contradicted its own schema (erratum)

`identity.md` §5 printed `typeId` as `^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$`. The schema's pattern is `^[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$` — with `_` — and carries `maxLength: 256`.

The doc's table therefore **rejected `vendor.acme.my_tools.echo`, which the very next paragraph of the same section said MUST be legal.** The table is corrected to the schema, and that paragraph is deleted: it duplicated `ids.schema.json`'s `typeId` description, which states the rationale more completely. Rationale belongs in the schema, where it costs no words against the RFC 0174 §E.2 budget; the core doc keeps the rule.

## Compatibility

`additive`, against COMPATIBILITY.md §2.2's list:

| Question | Answer |
| --- | --- |
| Required field optional/removed/retyped? | No field changes. |
| Optional field retyped? | No. |
| Event type shape changed? | No. |
| Endpoint contract changed? | A new **accepted** path-parameter spelling; the existing one still MUST work. |
| A `MUST` relaxed? | No. Three added (accept, emit, do-not-mint); five grammars widened. |
| Error code / status meaning changed? | No. `400 validation_error` for a malformed escape is the existing code for malformed input. |

The one behaviour a host must change is **emit** side: a host spelling `%2F` in its links must switch to the projection. That is the point of the RFC — a link is the spelling a host hands every client, and leaving it as `%2F` re-creates the outage for everyone who follows it.

## Conformance

- `conformance/src/scenarios/v2-bound-id-path-projection.test.ts` (new, major 2, unaided, no seam required). Creates one run and asserts: the projection contains only unreserved characters; `GET /runs/{projected}` is 200 **and returns the same run**; a link carrying the id uses the projection and not `%2F`; a malformed escape is refused `400`.
- `conformance/src/lib/bound-id.test.ts` (new self-test). The codec's edge cases are a unit concern, not a host concern.

**This witness needs no `conformance.seamsProfile`,** which I previously told both hosts it would. I was wrong in the pessimistic direction: I assumed witnessing the *escaping* required a host to mint an id containing an exotic character, which needs a seam. It does not — **the separator is already in every tenant-bound id**, so `/` → `~2F` is witnessed by any run a host can create. Only a literal `~` in an id would need a seam, and §A.2 legislates that case out of existence rather than testing for it.

**Witnessed against a running host, with negative controls.** A six-variant stub host was driven by the real scenario: a conforming host **passes**, and five distinct defects each red their own leg —

| host variant | defect | leg that caught it |
| --- | --- | --- |
| `conforming` | — | **passes** |
| `percent-only` | the pre-RFC-0184 host: understands `%2F`, not `~` | accept side, 404 |
| `emit-legacy` | accepts `~` but still spells links `%2F` | emit side |
| `lax-decoder` | 404s a malformed escape instead of 400 | decoder rule |
| `wrong-run` | resolves the segment to a different run | injectivity |
| `double-ok` | un-projects twice, so a double-projected segment resolves | §A.5 apply-once |

The first attempt at the `wrong-run` control was **vacuous** — it looked for a second run to hand back and the scenario creates only one, so the stub served the correct run and the leg passed. A negative control that cannot fail is worth less than no negative control, because it reports confidence.

The self-test is sabotage-checked: three plausible wrong codecs (marker unescaped, UTF-16 code units instead of UTF-8 bytes, decoder tolerating a lone `~`) were each injected and each turned the suite red (3, 2 and 1 failures respectively), then the codec was restored green. A round-trip suite built only from already-safe ids passes all three.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep `%2F`, tell hosts to fix their front doors | The protocol would work only where an operator has already fixed something they have no reason to look at. The failure is silent and total. |
| base64url the whole bound id | Not the identity on safe input. Every id in every log, trace and support ticket changes shape, for a problem one character causes. |
| Escape the separator only | Ambiguous the moment a legal id contains the escape, and this grammar has already widened once (§A.3). |
| Substitute `/` with `.` or `:` | Both are legal inside ids: `a.b/c` and `a/b.c` collide. |
| Apply the projection conditionally | Reintroduces the collision above, and makes a host's behaviour depend on the id's content rather than its kind. |
| Two path parameters (`/runs/{tenant}/{opaque}`) | Changes every route in `api/v2/openapi.yaml` and every client. Breaking, for a transport problem. |

## Unresolved

- **Does `anon:` belong on `tenantId`?** §A.3 shows the stated justification is false. Removing it needs a major. Neither production host has been censused for `anon:`-prefixed tenants; that census should happen before v3.
- **Should `~` be removed from the id character class entirely** (rather than only from minting)? That would make the codec injective over all input, not just its own output, and retire §A.2's legacy clause. It is a narrowing, so: v3.

## Acceptance criteria

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | The projection is specified normatively with encode, decode and the malformed rule | `identity.md` §5; `ids.schema.json` `$comment` |
| 2 | A host MUST accept and MUST emit it; the percent form still MUST be accepted | `identity.md` §5 |
| 3 | Minting a `~` is forbidden; existing ids still resolve | `identity.md` §5 §A.2 |
| 4 | The five tenant-bound kinds admit the tenant grammar they reference | `ids.schema.json`; the five patterns |
| 5 | `identity.md`'s `typeId` row matches the schema | `identity.md` §5 table |
| 6 | The codec is witnessed against a host, unaided, with no seam | `v2-bound-id-path-projection.test.ts` |
| 7 | The codec self-test is proven able to fail | three sabotages, §Conformance |
| 8 | The projection is applied exactly once | §A.5; `double-ok` control |
| 9 | The SCENARIO is proven able to fail | six host variants, §Conformance |
