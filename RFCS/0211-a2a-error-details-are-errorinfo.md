# RFC 0211: an A2A error's details are an ErrorInfo, and an A2A interface never answers in the OpenWOP envelope

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0211                                                            |
| **Title**         | an A2A error's details are an ErrorInfo, and an A2A interface never answers in the OpenWOP envelope |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-23                                                      |
| **Updated**       | 2026-09-24 — `Active → Accepted`, **provisional pending RFC 0156 §B retrospective review** (the window was waived by steward override; register row `not-reviewed`). Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host; single witness, on the published suite 2.38.0, build `commit:1157625f`, nothing relaxed, all profiles certified; every §Conformance host leg `executed-pass`. Invariant `a2a-error-no-existence-oracle` graduates to protocol tier. Earlier: 2026-09-23 — filed and moved `Draft → Active` the same day; **comment window waived** by the steward on 2026-09-23 — an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the window for an RFC of this risk class. This RFC is in that class on one axis: §D decides what an A2A error may disclose about a task the caller cannot read, which is **isolation** (`interop.md` §"The operation mappings" **Isolation**). It is recorded in `MAINTAINERS.md` as an override, not as a routine waiver, and carries its own ledger row rather than being folded under RFC 0208's (0208's override was taken for the operation map; stacking a second isolation rule on it is the compounding §A.6 exists to prevent). **Acceptance is provisional and the RFC 0156 §B retrospective review is owed** (register row `not-reviewed`). Evidence gate not waived: `Accepted` needs a bundle from a **deployed** revision of a tier-1 or tier-2 host that advertises `a2a` at `1.0` and executes the §F legs non-vacuously (GOVERNANCE §"Deployed, not merged"). |
| **Affects**       | `spec/v2/core/interop.md` §"The operation mappings" (+1 paragraph, **A2A error details**) · `spec/v2/interop-map.schema.json` (`errorRow` gains OPTIONAL `reason`) · `spec/v2/interop-map.json` (nine `reason` values) · `scripts/check-interop-map.mjs` (one rule) · `SECURITY/invariants.yaml` (+1, `a2a-error-no-existence-oracle`) · conformance: `v2-a2a-operation-map.test.ts` (isolation comparator rewritten; three legs added), `a2a-1-0-agent-card.test.ts` (client leg) · erratum notes on RFC 0152 UQ4 and `spec/v1/a2a-integration.md` §B, §D.7 |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §4 ("new normative requirement on a previously-undefined behavior") — the v2 corpus never defined the shape of `error.data`; plus one **Class 3** correction on record (§Compatibility) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The `a2a-1.0` profile pins A2A v1.0.1 and maps its nine errors to JSON-RPC codes (`spec/v2/interop-map.json` `a2a.errors`), but nothing in v2 says what an error's `data` looks like. Upstream does: on the JSON-RPC binding `error.data` is an **array** of ProtoJSON `Any` objects, each with an `@type` (A2A §9.5), and on HTTP+JSON the body is a `google.rpc.Status` whose `details` carry a `google.rpc.ErrorInfo` (§11.6). The suite's own fake A2A peer and the reference host emit a plain object `{ reason, domain, … }` instead, and three suite assertions pin that shape — so a client written against the suite parses a shape no upstream SDK sends.

This RFC states the upstream shape as the profile's rule (tightening §9.5's SHOULD to a MUST for the ErrorInfo entry, which both official SDKs already meet), forbids the OpenWOP error envelope on any A2A interface URL, gives a client the tolerance it needs for 2.x, fixes where `supportedVersions` travels now that `ErrorInfo.metadata` is a string map, and rewrites the one isolation leg whose comparison becomes vacuous once `data` is an array.

## Motivation

Verified read-only on 2026-09-23 against corpus `d593ad55`, `openwop-app` `main`, a2a-js `1.2.0` and a2a-python `1.1.5`.

### 1. Upstream says array; the corpus says nothing; the suite says object

- **Upstream.** A2A v1.0.1 §9.5: `error.data` is an "array of objects, each containing a `@type` key, using ProtoJSON `Any`"; "Each object in the `data` array MUST include a `@type` key"; implementations SHOULD use `google.rpc.ErrorInfo`. §10.6 (gRPC) and §11.6 (HTTP+JSON) make ErrorInfo a MUST, with `reason` the error name in UPPER_SNAKE_CASE without the `Error` suffix and `domain` `"a2a-protocol.org"`.
- **Corpus.** `interop-map.schema.json` `errorRow` (`:385-431`) is closed and carries `jsonrpc`, `grpc`, `http` — no `reason`, no body shape. `interop.md` names error types only. A grep of `spec/v2`, `api/v2` and `conformance/src` for `ErrorInfo`, `google.rpc` and `@type` finds nothing. The only statement is v1 `a2a-integration.md` §D.7 ("The JSON-RPC code and the `reason` are MUST-level"), which never says where `reason` sits on JSON-RPC.
- **Suite.** `conformance/src/lib/a2a-fake-peer.ts:439,447` emits `data: { reason, domain, … }`; `a2a-1-0-agent-card.test.ts:118,164,167` assert `error.data.reason`.
- **Reference host.** `openwop-app` `backend/typescript/src/host/a2aServer10.ts:65-73` emits `data: { reason }`; its client codec `a2aCodec10.ts:167` reads `e.data` as an object, so against an a2a-js or a2a-python peer `reason` is `undefined` and `supportedVersions` is silently dropped (identification still succeeds through the numeric code).
- **Upstream SDKs** already emit the array: a2a-js 1.2.0 `errors/index.js:405,410`; a2a-python 1.1.5 `error_handlers.py:52`, `response_helpers.py:139`.

### 2. `supportedVersions` has no legal home under the upstream shape

RFC 0152 UQ4 and v1 `a2a-integration.md` §B put `supportedVersions[]` "in the error detail". `ErrorInfo.metadata` is `map<string, string>`, so an array cannot sit there, and no upstream SDK emits `supportedVersions` at all. The card already carries the authoritative list (`supportedInterfaces[].protocolVersion`).

### 3. The isolation leg becomes vacuous the moment the shape is fixed

`v2-a2a-operation-map.test.ts:187` compares `Object.keys(error.data)` between an unknown-task answer and a foreign-tenant answer. For any one-element array that is `["0"]` on both sides, so the leg would pass whatever the entry discloses.

### 4. Nothing forbids the OpenWOP envelope on an A2A URL

Pre-dispatch refusals on the reference host's A2A route answer in OpenWOP's `{ error, message }` envelope (`agents.ts:864` when disabled; shared 401 / 413 / 429 middleware), and an unsupported `A2A-Version` answers `-32600` with `data:{supportedVersions}` (`agents.ts:912-919`) where upstream and v1 §B require `-32009`. No rule makes either wrong.

## Proposal

### §A The JSON-RPC binding carries an `Any[]` with an ErrorInfo

On an interface whose `protocolBinding` is `JSONRPC` at `protocolVersion` `1.0`, every A2A error response MUST carry `error.data` as an array of objects, each with an `@type`, and that array MUST include exactly one `type.googleapis.com/google.rpc.ErrorInfo` whose `reason` is the A2A error name in UPPER_SNAKE_CASE without the `Error` suffix and whose `domain` is `"a2a-protocol.org"`. The value is the `reason` on the error's row in `spec/v2/interop-map.json` `a2a.errors`. The invalid-parameters error (`-32602`) carries no A2A `reason`; it SHOULD carry a `google.rpc.BadRequest` and MAY carry nothing.

This is an **OpenWOP tightening** of upstream §9.5, which says SHOULD for ErrorInfo on JSON-RPC. It costs nothing: both official SDKs already emit it (§Motivation 1), and it lets a client identify the error the same way on every binding.

### §B HTTP+JSON answers a `google.rpc.Status`

A host that lists an `HTTP+JSON` interface MUST answer an A2A error on it with the §11.6 body `{ "error": { "code", "status", "message", "details": [ ErrorInfo, … ] } }`. Upstream §6.4's example answers `VersionNotSupportedError` with `application/problem+json`; §6.4 is in "Common Workflows & Examples", §1.4 makes the proto and the protocol requirements normative, and §11.6 is the MUST — so §11.6 governs, and a client SHOULD tolerate `problem+json` on that binding. No committed host lists HTTP+JSON today.

### §C No OpenWOP envelope on an A2A interface URL

Every response on an interface URL the host's card lists — including refusals before dispatch (authentication, body size, rate limit, malformed JSON-RPC) — MUST be in that interface's binding shape and MUST NOT be the OpenWOP error envelope (`schemas/v2/error-envelope.schema.json`). An authentication refusal on JSON-RPC MAY be an HTTP `401` with a JSON-RPC error body or with no body; it MUST NOT be `{ error, message }`. An interface the card does not list is not an A2A interface and is not bound.

### §D An error discloses nothing about a task the caller cannot read

On `TaskNotFoundError`, `data` MUST NOT differ between an unknown task and a task the caller cannot read, except for an echo of the requested id. This extends `interop.md` **Isolation** from the code to the details.

### §E `supportedVersions` is a comma-joined string, and the card is the fallback

On `VersionNotSupportedError` the host SHOULD set `ErrorInfo.metadata.supportedVersions` to its offered versions for that interface as a comma-joined string (`"1.0,0.3"`), and MAY set `metadata.requested`. A client MUST NOT depend on either: when absent, it reads the versions from the card's `supportedInterfaces[].protocolVersion`. This amends RFC 0152 UQ4 and v1 `a2a-integration.md` §B/§D.7 ("`supportedVersions[]` in the error detail"), whose array form cannot live in `map<string,string>` — see §Errata.

### §F A client reads either shape through 2.x

A host acting as an A2A client MUST identify an error by its JSON-RPC code or by the ErrorInfo `reason` found in `data[]`, MUST accept `data` as an `Any[]`, and SHOULD accept a `data` object carrying `reason` for the remainder of 2.x — the suite peer through 2.36.x and the reference host shipped that shape. It MUST tolerate non-string `metadata` values and upstream's `reason` values for non-A2A errors (`UNKNOWN_ERROR`, `INVALID_REQUEST`, observed in a2a-python 1.1.5). §A–§D bind only 1.0 interfaces; the 0.3 codec is out of scope.

### Wire examples

Positive (JSON-RPC, `TaskNotFoundError`):

```json
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32001, "message": "task not found",
  "data": [ { "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              "reason": "TASK_NOT_FOUND", "domain": "a2a-protocol.org",
              "metadata": { "taskId": "t-1/abc" } } ] } }
```

Negative (fails §A — object, not array; fails §D if `scope` appears only on the foreign answer):

```json
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32001, "message": "task not found",
  "data": { "reason": "TASK_NOT_FOUND", "scope": "tenant" } } }
```

## Errata

- **RFC 0152 UQ4** (`RFCS/0152-…:89`), appended: *"Erratum 2026-09-23 (RFC 0211 §E): `supportedVersions[]` cannot sit in `google.rpc.ErrorInfo.metadata`, which is `map<string,string>`. It travels as `metadata.supportedVersions`, a comma-joined string, at SHOULD; the card's `supportedInterfaces[].protocolVersion` is authoritative."*
- **`spec/v1/a2a-integration.md` §B** (`:346`) — replace "and upstream's `supportedVersions[]` in the error detail" with "and, SHOULD, `ErrorInfo.metadata.supportedVersions` as a comma-joined string (RFC 0211 §E); a client falls back to the card".
- **`spec/v1/a2a-integration.md` §D.7** (`:491`) — replace "(and `supportedVersions[]` for version errors)" with "(and `metadata.supportedVersions`, a comma-joined string, for version errors — RFC 0211 §E)".

## Compatibility

- **Additive** under `COMPATIBILITY.md` §4: v2 never defined `error.data`; §A–§D are new requirements on previously-undefined behavior, and every one binds only a host that advertises `a2a` with a 1.0 interface.
- **Class 3 correction on record** for the suite: the fake peer's object shape contradicted upstream §9.5, which the `a2a-1.0` profile incorporates by pin. Fixing it convicts no host (those tests run against the suite's own peer).
- **Census (R3):** 0 of 3 committed `evidence/v2-host-bundles/*.json` carry a row for `v2-a2a-operation-map` or `a2a-1-0-agent-card`; only `openwop-host-v2-reference.json` (suite 2.35.0) advertises `a2a` (`1.0`, no push, no streaming). MyndHyve's A2A is ingress-only and not advertised at v2.
- **No reshape.** `errorRow.reason` is an OPTIONAL property on a closed object (RFC 0197 §B.5). No error code, status or map row meaning changes.

## Conformance

### Landed before this RFC (cites upstream §9.5, not this RFC)

The fake-peer fix, #1510: `a2a-fake-peer.ts` emits `Any[]` (`a2aErrorInfo()`); `a2a-1-0-agent-card.test.ts` reads `reason` through a helper that finds the ErrorInfo in `data[]`. Rides the open 2.37.0 cycle (#1508).

### Lands with this RFC (`Active`)

| Leg (scenario) | Assertion | Sabotage that MUST turn it red |
| --- | --- | --- |
| `a2a-error-data-shape` (`v2-a2a-operation-map`) | `GetTask` on an unknown id: `data` is an array; one entry has `@type` ErrorInfo, `reason: TASK_NOT_FOUND`, `domain: a2a-protocol.org`. Repeated for `CancelTask` on a terminal run (`TASK_NOT_CANCELABLE`) | host emits `{reason}`; emits `[]`; `reason: "TaskNotFound"`; wrong `domain` |
| `a2a-unreadable-not-found` (rewritten comparator) | per-element normalised form (`@type`, `reason`, `domain`, sorted metadata keys, `taskId` echo removed) equal between unknown and foreign-tenant answers | host adds `metadata.scope:"tenant"` only on the foreign answer |
| `a2a-no-openwop-envelope` (`v2-a2a-operation-map`) | malformed JSON-RPC and an unauthenticated POST to the card's JSON-RPC URL: body is not `{error,message}` (validated **not** to match `error-envelope.schema.json`) | route error handler returns the OpenWOP envelope |
| `a2a-version-not-supported-shape` (`v2-a2a-operation-map`) | `A2A-Version: 99.0` ⇒ `-32009`, ErrorInfo `VERSION_NOT_SUPPORTED`; if `metadata.supportedVersions` present it is a comma-joined subset of the card's versions | host answers `-32600` (openwop-app today) |
| `a2a-client-reads-either-shape` (`a2a-version-negotiation`, host as client via the §22 invoke seam) | with the fake peer in `Any[]` mode and in legacy-object mode, a `-32009` from the peer is projected to `interop_version_unsupported` in the OpenWOP envelope — not `internal_error`, not a raw upstream body | host parser throws or mis-projects on one shape (e.g. dereferences `data.reason` on an array and fails the call as `internal_error`). **Weak by construction**: a host that reads only the object shape still identifies the error by its code, so this leg witnesses tolerance of both shapes, not that the host reads `reason` from the array. `interop_version_unsupported` has `details: null` in `spec/v2/errors.json`, so no projected `supportedVersions` is asserted |
| `a2a-httpjson-status` | gated on the card listing `HTTP+JSON`; `inapplicable` on every committed host today and **not claimed as a witness** | — |

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A `Any[]` + ErrorInfo | the JSON-RPC error body | the suite, unaided (unknown id) | witnessable |
| §B `google.rpc.Status` | the HTTP+JSON error body | the suite, when a host lists HTTP+JSON | witnessable-gated (no host today) |
| §C no OpenWOP envelope | body on a pre-dispatch refusal | the suite, unaided (bad JSON, no credential) | witnessable |
| §D no differing details | normalised `data` of two answers | the suite, unaided (fabricated foreign tenant) | witnessable |
| §E SHOULD `supportedVersions` | metadata on `-32009` | the suite, unaided | witnessable (SHOULD — recorded, not failed) |
| §F client accepts `Any[]` and legacy | projected error code under both peer shapes | the suite's fake peer via the §22 invoke seam | seam-gated (tolerance only; reading `reason` from the array is not independently observable while the code identifies the error) |

## Security

New invariant `a2a-error-no-existence-oracle` (protocol, high) — §D. `interop.md` **Isolation** has had no invariant row; the precedents are `content-no-cross-tenant-enumeration` and `auth-challenge-no-oracle`.

## Alternatives considered

- **Keep the object shape and call it the OpenWOP profile.** Rejected: the pin incorporates §9.5's MUST that every `data` element carry `@type`, which an object cannot satisfy; and every upstream SDK already sends the array.
- **Carry `supportedVersions` as a second `Any` of a custom type.** Rejected: a type URL OpenWOP mints is a private extension no SDK parses; the card already carries the list.
- **Amend RFC 0208 in place.** Rejected: §A's MUST, §C and §D are new obligations a host could have been relying on the absence of; in-place amendment is for text nobody could rely on.
- **Make §C a SHOULD.** Rejected: a client that receives `{error,message}` from an A2A URL cannot identify the failure by code or reason at all — the case the profile exists to prevent.

## Unresolved questions

1. Whether a 401 on the JSON-RPC binding should carry a JSON-RPC body is left open upstream (§3.3.2); §C permits either. Raise upstream with the §6.4/§11.6 inconsistency (program Phase 6).

## Acceptance criteria

- [x] `interop.md` paragraph, map `reason` values, gate rule, invariant and legs land (`Active` PR). — #1514 (2026-09-23): interop.md §"A2A error details", `errorRow.reason` values, `check-interop-map` rule 7a, invariant and legs landed.
- [x] Suite carrying the legs (2.37.0, or the next minor if 2.37.0 publishes first) published with the §Conformance legs; each sabotage run and red for the named reason. — published in suite 2.37.0 (2026-09-24, npm `latest` at the time) with the legs; every sabotage in #1514 turned its named leg red.
- [x] A **deployed** tier-1 or tier-2 host advertising `a2a` 1.0 records `executed-pass` on `a2a-error-data-shape`, `a2a-unreadable-not-found`, `a2a-no-openwop-envelope` and `a2a-version-not-supported-shape` in a committed bundle, the flip checked against its live `/.well-known/openwop` (GOVERNANCE §"Deployed, not merged"). — the committed, certified public cut of the v2 reference host on published suite 2.38.0 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, #1542; build `commit:1157625f`, signed `v2-reference-4`, witness `669d926abf45…`, guard closed, `relaxations` empty; `--verify --host-key` → VERIFIED): `0211.a2a-error-data-shape`, `.a2a-unreadable-not-found-details`, `.a2a-no-openwop-envelope`, `.a2a-version-not-supported-shape` and `.a2a-client-reads-either-shape` all `executed-pass`. The live check against `/.well-known/openwop` is the one the certify run made through the public front at cut time (`discovery.sha256` `c71ccf4bbc72…` in the bundle); the tunnel is closed now. Tier-1 single witness, a reference example and not a production host (precedent: RFC 0194/0195). openwop-app does not advertise `a2a` at major 2, so it cannot witness this RFC.
- [x] RFC 0156 §B retrospective row for this override exists (`not-reviewed`). — `docs/WAIVER-RETROSPECTIVE-REGISTER.md` row 0211 (`not-reviewed`).

## References

A2A v1.0.1 `docs/specification.md` §1.4, §3.3.2, §5.4, §6.4, §9.5, §10.6, §11.6 (tag `v1.0.1`); `a2a.proto` (vendored `conformance/fixtures/upstream/a2a-v1.0.1/`); RFC 0147 §A.6; RFC 0152 UQ4; RFC 0197 §B.5; RFC 0208; `spec/v1/a2a-integration.md` §B, §D.7.
