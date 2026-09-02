# RFC 0165: v2 preparation — additive wire shapes (`protocolVersions[]`, the Subject record, header dual emission)

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0165                                                            |
| **Title**         | Three additive v1.x shapes that turn three v2 cuts into removals: a root `protocolVersions[]` array beside the scalar `protocolVersion`; an optional `owner.subject` record (issuer-scoped, lane-typed, with an actor chain) on `RunSnapshot` and the `run.started` echo, with the legacy-subject and fork-copy rules; and dual emission of `OpenWOP-*` webhook headers and a standard `ETag` on the discovery document beside their v1 forms. |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-02                                                      |
| **Updated**       | 2026-09-02 (`Draft → Active` in the filing PR: the three shapes, the Subject schema, the prose rules, two invariants, three new scenarios and four added legs landed together at suite 1.155.0; the additive comment window waived per `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0147 §A.6 overridden and named in §Compatibility. `Active → Accepted` gates on the openwop-app and MyndHyve host legs.) · 2026-09-02 (filed)
| **Affects**       | `schemas/capabilities.schema.json` (root `protocolVersions`) · NEW `schemas/subject.schema.json` · `schemas/run-snapshot.schema.json` (`owner.subject`) · `schemas/run-event-payloads.schema.json` (`runStarted.owner.subject`, `runStarted.owner.principalKind`) · `spec/v1/version-negotiation.md` (§"Protocol version grammar" — the array) · `spec/v1/capabilities.md` (root table) · `spec/v1/auth.md` (§"Subject record") · `spec/v1/auth-profiles.md` (§"Subject linking" — legacy and A2A rules) · `spec/v1/replay.md` (fork ownership) · `spec/v1/webhooks.md` (§"Headers", §"Signature algorithm versioning") · `spec/v1/capabilities-change-detection.md` (§"Cache validators") · `api/openapi.yaml` (discovery `ETag`/`If-None-Match`/304) · `SECURITY/invariants.yaml` (+2) · `SECURITY/threat-model-auth-profiles.md` · `spec/v1/deprecations.json` (3 rows: `engineVersion` axis, `X-openwop-*` family, `Capabilities-Etag` — `proposed` → `deprecated`) · conformance: new `protocol-versions-array.test.ts`, `owner-subject-shape.test.ts`, `owner-subject-echo.test.ts`; legs in `webhook-signed-delivery.test.ts`, `discovery.test.ts`, `auth-subject-link.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — every field is optional and lands on an open root or as a declared optional member of a closed object; no required field, type, event shape, endpoint contract, MUST, or error code changes. The two new MUSTs (§B.3 legacy subject, §B.4 fork copy) bind only hosts that emit the new shape or on previously-undefined behavior — see §Compatibility. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and recorded in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers"; RFC 0147 §A.6 (identity RFCs complete the full window) is overridden here and says so. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The v2 charter (program items C.2, C.3, C.4, C.5) plans to remove three v1 shapes at the v2 major: the scalar `protocolVersion` as the only version advertisement, the bare `owner.principal` string as the only identity record, and the `X-openwop-*` / `Capabilities-Etag` header family. Each removal is cheap only if its replacement already exists on the wire and hosts already populate it. This RFC lands the three replacements additively in v1.x so that the v2 cut deletes rather than invents:

1. **`protocolVersions: string[]`** at the discovery root, strict `MAJOR.MINOR` grammar, containing the scalar's value. Consumers that understand it can negotiate a major; v1 consumers ignore it. Profile derivation does not change.
2. **`owner.subject`**, an optional `Subject` record `{ issuer, subjectId, tenant, lane, kind, keyClass?, actor? }` on `RunSnapshot.owner` and on the `run.started` owner echo. With `issuer` in the key, two identity providers issuing the same identifier are distinct by construction rather than by prose. Three rules travel with it: a host that emits subjects stamps a **legacy** subject (`issuer: "urn:openwop:legacy"`, never linkable) on runs that predate the shape; a forked run copies the source's `owner.tenant` and `owner.subject` verbatim; an A2A-forwarded, never-authenticated end user is `kind: "anonymous"` with the forwarding peer as `actor`.
3. **Dual emission**: webhook deliveries SHOULD carry `OpenWOP-Signature`, `OpenWOP-Timestamp`, `OpenWOP-Signature-Algorithm`, `OpenWOP-Webhook-Id`, `OpenWOP-Event-Type` beside the `X-openwop-*` forms with identical values, and subscribers SHOULD accept either; the discovery document SHOULD carry a standard `ETag` and honor `If-None-Match` beside `Capabilities-Etag`.

## Motivation

**Versioning.** `protocolVersion` is a scalar. A host cannot advertise that it speaks both v1 and v2, yet `COMPATIBILITY.md` §5 requires the v2 RFC to carry "a coexistence plan: how v1 and v2 servers interoperate during the transition (typically a discovery field that advertises support for both)". The embedded A2A and MCP blocks already carry `protocolVersions[]` arrays (RFC 0152 §A, RFC 0153 §A); the root does not. Landing the array now means the v2 coexistence plan is "read the field that has been there since 1.155".

**Identity.** v1 has no principal schema. `RunSnapshot.owner.principal` is a bare `minLength: 1` string that each of eight authentication lanes mints by its own undocumented rule, which is why RFC 0159 had to be written: two lanes, two subjects, one human. The `saml:` / `scim:` prefixes appear once in the corpus, in a non-normative parenthetical (`auth-profiles.md` §"Subject linking"). RFC 0154 §B already describes an actor chain for delegated calls but binds it to a request-context object that no run ever records. The v2 charter's C.3 requires a Subject record; landing it optionally now lets both hosts populate it before v2 requires it, and lets the legacy rule be written while the history it covers is small.

**Headers.** Seven header naming schemes coexist on one surface (`webhooks.md` §"Headers", `capabilities-change-detection.md`, `api/openapi.yaml`); the v2 charter's C.4 makes every non-standard header `OpenWOP-*`. A signature header is the one place where sender and verifier upgrade independently and no discovery flag coordinates them, so the only safe migration is a period in which both forms are on the wire. That period has to start in v1.x or the v2 cut breaks every existing subscriber. The same applies to cache validators: `Capabilities-Etag` duplicates the standard `ETag` / `If-None-Match` pair that `GET /v1/runs/{runId}` already uses (RFC 0115); v2 keeps the standard one.

**Why one RFC.** The three shapes share one host leg (each of openwop-app and MyndHyve implements all three in one change), one compatibility argument (§2.1 additive, every field optional), and one lifecycle (each is a v2 removal's precondition). Splitting them would triple the waiver entries and the register sweeps for no review benefit under sole-steward operation.

## Proposal

### §A — `protocolVersions[]`

**§A.1 Shape.** `capabilities.schema.json` root gains:

```json
"protocolVersions": {
  "type": "array",
  "minItems": 1,
  "uniqueItems": true,
  "items": { "type": "string", "pattern": "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" },
  "description": "RFC 0165 §A. Every protocol major.minor this host speaks, newest first by convention. OPTIONAL in v1.x; MUST contain the value of `protocolVersion`. Consumers that do not understand it ignore it. Profile derivation reads `protocolVersion` only (profiles.md)."
}
```

The item grammar is the root scalar's strict grammar (`version-negotiation.md` §"Protocol version grammar", RFC 0149 §C), **not** the looser A2A item pattern `^[0-9]+\.[0-9]+$`, which admits `01.0`. One axis, one grammar.

**§A.2 Rules.**

- A host that advertises `protocolVersions` **MUST** include the exact value of `protocolVersion` in it.
- A host **MUST NOT** advertise a major in `protocolVersions` that it does not serve; a v1.x host advertises `["1.<minor>"]` until it serves v2.
- Profile derivation (`profiles.md` §`openwop-discovery-core`, conformance `isCore`) **MUST** continue to read `protocolVersion` alone in v1.x. The array is an advertisement for major negotiation, not a profile input.
- Consumers **MUST** treat an absent `protocolVersions` as `[protocolVersion]`.

**§A.3 Negotiation (informative until v2).** A v2-aware client reads `protocolVersions`; when `2.<n>` is present it MAY select the v2 contract via the mechanism the v2 RFC defines (an `OpenWOP-Version` request header, per charter C.5); otherwise it uses v1. Nothing in v1.x acts on the array; this RFC reserves the field and its grammar.

**§A.4 The `engineVersion` axis (recorded, not changed).** `engineVersion` is an integer at the discovery root (`capabilities.schema.json`) and an unconstrained string on `run-event.schema.json`, `run-snapshot.schema.json`, and three event payloads; `version-negotiation.md` calls it a number. Changing either type is a `COMPATIBILITY.md` §2.2 break, so this RFC does not. It records the axis in `spec/v1/deprecations.json` as a `proposed` row (`openwop.deprecation.engine-version-type-split`, unify at 2.0) and states in `version-negotiation.md` that the root value is the integer form and the per-event value is its decimal string rendering.

### §B — The Subject record

**§B.1 Shape.** New `schemas/subject.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/subject.schema.json",
  "title": "OpenWOP Subject",
  "type": "object",
  "additionalProperties": false,
  "required": ["issuer", "subjectId", "tenant", "lane", "kind"],
  "properties": {
    "issuer":    { "type": "string", "minLength": 1, "pattern": "^\\S+$", "description": "Trust root that asserted this subject: IdP entityID (SAML), OIDC `iss`, CA subject (mTLS), API-key realm, SCIM connection id, or `urn:openwop:legacy` (§B.3)." },
    "subjectId": { "type": "string", "minLength": 1, "maxLength": 512, "pattern": "^[^@\\s]+$", "description": "Opaque, stable, issuer-scoped identifier. MUST NOT be an email address, display name, or credential (invariant `subject-record-opaque`)." },
    "tenant":    { "type": "string", "minLength": 1, "description": "MUST equal the enclosing `owner.tenant`." },
    "lane":      { "type": "string", "enum": ["api-key", "oauth2", "oidc", "mtls", "saml", "scim", "ldap", "workload"], "description": "The authentication lane that minted the subject (auth-profiles.md)." },
    "kind":      { "type": "string", "enum": ["user", "agent", "anonymous", "workload"], "description": "Superset of `owner.principalKind` (RFC 0132) with `workload` (RFC 0154)." },
    "keyClass":  { "type": "string", "enum": ["opaque-idp", "configured-immutable"], "description": "How `subjectId` was derived when the lane is linkable (RFC 0163 §A). Present iff the lane is `saml` or `scim`." },
    "actor":     { "$ref": "#", "description": "Who is acting on this subject's behalf (delegation). Depth MUST NOT exceed 4 (§B.5)." }
  }
}
```

`run-snapshot.schema.json` `owner` and `run-event-payloads.schema.json` `runStarted.owner` each gain `"subject": { "$ref": "subject.schema.json" }` as a declared optional member. `runStarted.owner` also gains the `principalKind` member that `RunSnapshot.owner` has carried since RFC 0132 and the echo lacks (so a host that echoes its own snapshot owner no longer emits a payload that fails validation).

**§B.2 Consistency rules.** When `owner.subject` is present:

- `subject.tenant` **MUST** equal `owner.tenant`.
- When `owner.principal` is also present, `subject.subjectId` **MUST** equal it. (Hosts SHOULD keep emitting `principal` through v1.x; v2 removes it.)
- When `owner.principalKind` is also present, `subject.kind` **MUST** equal it, except that `subject.kind: "workload"` corresponds to `principalKind` absent.
- `subject.keyClass` **MUST** be present when `lane` is `saml` or `scim` and **MUST** equal the class the host advertises in `capabilities.auth.subjectLinkKey` when both `openwop-auth-saml` and `openwop-auth-scim` are advertised (RFC 0163 §A, RFC 0164 §A.3).
- `subject.subjectId` **MUST NOT** contain `@` or whitespace and **MUST NOT** be a credential, token, certificate, or display name (invariant `subject-record-opaque`; the schema pattern is the claims-check).

**§B.3 Legacy subjects.** A host that emits `owner.subject` on new runs **MUST** answer reads of runs created before it began emitting subjects with a synthesized subject `{ issuer: "urn:openwop:legacy", subjectId: <owner.principal>, tenant: <owner.tenant>, lane: <the lane the host can attest, else "api-key">, kind: <owner.principalKind ?? "user"> }`, and **MUST NOT** treat a legacy subject as linkable under RFC 0159/0164 (invariant `subject-legacy-not-linkable`). A run with no `owner.principal` at all yields no subject. Why: openwop-app's `runs` table stores tenant only; nothing can backfill `issuer` or `lane`, and a guessed issuer would make two hosts invent two different identities for one historical run (RFC 0159's defect, one layer down).

**§B.4 Fork ownership.** `POST /v1/runs/{runId}:fork` (`replay.md`) **MUST** copy the source run's `owner.tenant` and, when present, `owner.subject` verbatim onto the child. The child's `owner.principal` **SHOULD** be copied too. Why a MUST only for the new field: no text today binds fork ownership (`replay.md` and RFC 0006 are silent; only `auth-profiles.md` §"Subject linking" asserts it, without authority), and a host that re-owns forks to the forking principal is conforming now; this RFC cannot tighten that for `principal` without a §2.2 break, but it can and does for `subject`, which no host emits yet. The same-key invariant the SAML/SCIM leaver contract depends on ("nothing rewrites a subject key already stamped on a run") is thereby stated where it belongs.

**§B.5 Actor chain.** `subject.actor` carries the delegating subject (RFC 0154 §B's `onBehalfOf` relation, inverted to the run's point of view: the run's owner is the effective principal; `actor` is who acted). Depth **MUST NOT** exceed 4; a host **MUST** refuse (`run_forbidden`) rather than truncate. `actor` is provenance, not authorization (RFC 0154 §B); a caller **MUST NOT** self-assert it. The delegation proof format is the one RFC 0154 §C names for the lane (mTLS or DPoP key binding, else advertised bearer fallback); this RFC adds no new proof.

**§B.6 A2A anonymous actors (RFC 0132 G5).** A peer-forwarded, never-authenticated end user on an A2A entry **MUST** be recorded as `kind: "anonymous"` with the forwarding peer's subject as `actor`, **MUST NOT** be linked under RFC 0159/0164, and carries the RFC 0128 purpose label across the boundary unchanged. RFC 0132 §A.5's prohibition on setting `principalKind: "anonymous"` for such a user is thereby narrowed: it remains forbidden without an `actor`, and is the required form with one.

### §C — Dual emission

**§C.1 Webhook headers.** `webhooks.md` §"Headers": a host **SHOULD** send, on every delivery, `OpenWOP-Webhook-Id`, `OpenWOP-Event-Type`, `OpenWOP-Timestamp`, `OpenWOP-Signature`, `OpenWOP-Signature-Algorithm` with values identical to their `X-openwop-*` counterparts. Subscribers **SHOULD** accept either family and **MUST** verify the same bytes (`{timestamp}.{rawBody}`) whichever they read. A host that advertises `webhooks.signatureAlgorithms` **SHOULD** list `"v1"` regardless of which header family a subscriber reads; this RFC adds no scheme. The `X-openwop-*` family enters `spec/v1/deprecations.json` as `deprecated` (removeIn 2.0) with this RFC as authority.

**§C.2 Discovery cache validator.** `capabilities-change-detection.md` §"Cache validators": a host **SHOULD** send a standard `ETag` on `GET /.well-known/openwop` and **SHOULD** return `304 Not Modified` to a matching `If-None-Match` (today both are MAY). `Capabilities-Etag` keeps its semantics (negotiation-safety validator) through v1.x and enters the register as `deprecated` (removeIn 2.0). `api/openapi.yaml` declares `ETag`, the `If-None-Match` parameter, and the `304` response on the discovery operation.

**§C.3 SDKs.** The three reference SDKs' webhook helpers reject the spec's `sha256=`-prefixed `X-openwop-Signature` and read a header (`openwop-Webhook-Signature: v1=`) that appears in no spec file. That is an SDK-versus-spec defect, fixed in `openwop-sdks` in the same wave: the helpers verify `OpenWOP-Signature`, then `X-openwop-Signature`, then the legacy name, in that order.

## Compatibility

`additive` per `COMPATIBILITY.md` §2.1 ("new optional field in a response or event payload; new optional capability in the discovery document"):

- Existing required fields: unchanged (`protocolVersion`, `owner.tenant`, all event `required` lists).
- Existing optional fields: types unchanged; `engineVersion` deliberately left split (§A.4).
- Existing event types: `run.started` gains two declared optional members inside its closed `owner` sub-object; the payload root is already open.
- Existing endpoints: discovery gains optional response headers and an optional request header; `:fork` gains a rule on a field no host emits yet.
- Existing MUSTs: none relaxed. New MUSTs bind (§B.2–§B.6) only when a host emits `owner.subject`, or (§B.4) on behavior no text previously defined — `COMPATIBILITY.md` §4's "new normative requirement on previously-undefined behavior".
- Error codes: `run_forbidden` reused for §B.5 depth refusal; no new code.

Under `COMPATIBILITY.md` §4's "existing optional capability becomes default-on" row: nothing here becomes default-on; every shape is opt-in by emission.

**Waiver.** The 7-day additive window is waived under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`. RFC 0147 §A.6 forbids shortening the window for identity RFCs; this RFC is an identity RFC and overrides §A.6 for the reason §"Sole-steward operation" gives (there is no second organization to review), stated here rather than performed silently.

## Conformance

New scenarios (suite 1.155.0):

- `protocol-versions-array.test.ts` — presence-gated: when `protocolVersions` is advertised, every item matches the grammar, items are unique, the array contains `protocolVersion`, and the derived profile set is unchanged by its presence (server-free negative controls for `01.0`, `1.0.0`, missing scalar).
- `owner-subject-shape.test.ts` — server-free: `subject.schema.json` compiles; the owner subschemas in both files accept a valid subject, reject an unknown member, reject `subjectId` with `@`, reject `keyClass` on `lane: "oidc"`, reject depth-5 `actor` chains (the depth check is a scenario assertion, not schema).
- `owner-subject-echo.test.ts` — gated on a run whose snapshot carries `owner.subject`: the `run.started` echo equals the snapshot's subject; a fork's snapshot carries the same `tenant` and `subject`; `subject.tenant === owner.tenant`; `subjectId === principal` when both present.
- `auth-subject-link.test.ts` — one added leg: a legacy-issuer subject is never treated as linked (deactivation of a SCIM subject does not deny a SAML login whose run subject is legacy).
- `webhook-signed-delivery.test.ts` — added legs (capability-gated): when `OpenWOP-Signature` is present it equals `X-openwop-Signature`; same for the other four; verification succeeds reading either.
- `discovery.test.ts` — presence-gated leg: when `ETag` is present, a matching `If-None-Match` yields `304`.

Updated: `identity-owner-shape.test.ts` registers `subject.schema.json` in its Ajv instance. Invariants: `subject-record-opaque` (protocol, critical, witness `claims-check`, test `owner-subject-shape.test.ts`), `subject-legacy-not-linkable` (protocol, high, witness `negative-existence`, test `auth-subject-link.test.ts`).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.2 array contains `protocolVersion` | discovery document | any reader | witnessable, unaided |
| §A.2 no unserved major | a request under the advertised major succeeds | a v2 client (after v2) | witnessable — gated on v2 existing; until then claims-check |
| §A.2 profile derivation unchanged | derived profile set with and without the array | the suite (server-free) | witnessable, unaided |
| §B.2 tenant / subjectId / kind / keyClass consistency | snapshot + `run.started` | any reader with a run | witnessable — gated on a host emitting subjects |
| §B.2 `subjectId` opaque | schema pattern; a host emitting an email fails validation | the suite | claims-check (pattern), negative-existence (no PII) |
| §B.3 legacy subject synthesized and never linkable | read of a pre-subject run; leaver deny does not fire on it | a host with history + the SCIM seam | witnessable — seam-gated |
| §B.4 fork copies tenant + subject | `:fork` child snapshot | any client with fork | witnessable — gated on subjects |
| §B.5 depth ≤ 4, refused not truncated | `run_forbidden` on a depth-5 chain | a client asserting a chain via a lane that carries one | witnessable — gated on RFC 0154 lane |
| §B.6 A2A anonymous actor form | snapshot of an A2A-forwarded run | an A2A peer (fake peer in the suite) | witnessable — gated on `a2a` |
| §C.1 dual headers identical | a delivery | a subscriber (the suite's receiver) | witnessable — gated on `webhooks` |
| §C.2 `ETag` + 304 | two discovery fetches | any client | witnessable, unaided when present |

## Alternatives considered

1. **Do nothing; land all three at v2.** Rejected: the v2 cut would then invent shapes and require both hosts to migrate history and consumers in the same release as the envelope and error-registry cuts. The charter's Phase 1 exists to avoid exactly that.
2. **Three RFCs.** Rejected under sole-steward operation (one host leg, one waiver, one sweep); the sections are independently falsifiable and the register carries them per section.
3. **Put the Subject record only on the snapshot, not the echo.** Rejected: that reproduces the live `principalKind` divergence (snapshot has it, echo does not), where a host echoing its own owner fails payload validation.
4. **Backfill historical runs with a real issuer.** Rejected: no host stores the lane or issuer for old runs; a guess would create identities. The legacy issuer is the honest value.
5. **Rename headers outright at v1.x.** Rejected: §2.2 forbids removing the `X-openwop-*` family and a signer/verifier pair cannot be coordinated by a discovery flag; dual emission is the only additive path.
6. **Make `protocolVersions` derive profiles now.** Rejected: it would change the derived profile set of existing conforming documents (every profile derives from the scalar) — a §2.2 break.

## Unresolved questions

1. Which `lane` value does a host attest for a legacy subject when it kept no record? §B.3 says `api-key` as the floor. A host that can prove the lane from its audit log MAY use it. Resolved for v1.x by the floor; v2 may require the audit-derived value.
2. Should `actor` carry the RFC 0154 `delegation.proofRef`? Deferred: §B.5 keeps `actor` as provenance and points at RFC 0154 §C for the proof; the v2 C.3 child decides whether the ref is stamped on the run.
3. Whether `Capabilities-Etag` and `ETag` MUST change together. Left as SHOULD-level guidance in `capabilities-change-detection.md`; the v2 C.4 child deletes `Capabilities-Etag`.

## Implementation notes (non-normative)

- openwop-app: `discovery.ts` adds `protocolVersions: [protocolVersion]`; `runs` table gains nullable `subject_json`; the SAML/SCIM/OIDC/API-key lanes mint a subject at run creation from the same predicate `combinedSubjectLinkingActive()` reads; fork copies `subject_json`; read path synthesizes the legacy subject when `subject_json` is null; `webhookDeliveryWorker.ts` already dual-emits a legacy family and adds the `OpenWOP-*` one.
- MyndHyve: Firestore `runs/{runId}` document gains `owner.subject`; `discovery.ts` array; `webhookDelivery.ts` adds the five headers.
- SDKs (openwop-sdks): webhook helpers accept the three header names in order; TypeScript types gain `Subject` and `protocolVersions`.

## Acceptance criteria

- [x] `subject.schema.json` + both owner references + `protocolVersions` land with `npm run openwop:check` green and the three new scenarios + four added legs in suite 1.155.0. (This PR.)
- [x] `spec/v1/deprecations.json`: `engine-version-type-split` (`proposed`), `X-openwop-*` family and `Capabilities-Etag` flipped to `deprecated` with this RFC as authority. (This PR.)
- [x] Invariants `subject-record-opaque`, `subject-legacy-not-linkable` registered with tests; threat model updated. (This PR.)
- [x] `Draft → Active`: the above merged.
- [ ] `Active → Accepted`: openwop-app (tier-1) and MyndHyve (tier-2) each advertise `protocolVersions`, emit `owner.subject` on new runs with the legacy rule on old ones, dual-emit headers and `ETag`, and pass the gated scenarios non-vacuously; SDK helpers fixed and released.

## References

- v2 charter program items C.2, C.3, C.4, C.5 (the "OpenWOP v2 Charter" artifact, 2026-09-02).
- `COMPATIBILITY.md` §2.1, §4, §5; `GOVERNANCE.md` §"Sole-steward operation".
- RFC 0048 (owner triple), RFC 0132 (`principalKind`, anonymous), RFC 0149 §C (version grammar), RFC 0152/0153 (`protocolVersions[]` precedent), RFC 0154 (actor chain, proof), RFC 0159/0163/0164 (subject linking, key classes), RFC 0115 (`ETag` on runs).
- `docs/REQUIREMENT-REGISTRY-FEASIBILITY.md` addendum (why the per-`it` ledger these scenarios record into exists).
