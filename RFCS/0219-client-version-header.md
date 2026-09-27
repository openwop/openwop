# RFC 0219: a client announces the protocol version it implements in `OpenWOP-Client-Version`

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0219                                                            |
| **Title**         | a client announces the protocol version it implements in `OpenWOP-Client-Version` |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-27                                                      |
| **Updated**       | 2026-09-27 — filed `Draft`. · 2026-09-27 — `Draft → Active`. **Comment window waived** (7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation", logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the header neither authenticates nor selects a contract, and no replay, external-effect or certification preimage covers it. The six Unresolved questions are decided by the maintainer (§Decisions). The spec, OpenAPI, `errors.json` and scenario changes in §Implementation notes land with the flip; the malformed leg's hosts are measured before the PR merges |
| **Affects**       | `spec/v2/core/versioning.md` §1.5 (the header, its grammar, the comparison, when a `426` is permitted) · `api/v2/openapi.yaml` via `scripts/derive-v2-api.py` (one optional request header on every operation) and the generated `spec/v2/core/headers.md` · `spec/v2/errors.json` `client_version_unsupported` `details` (decision 5) and the generated `schemas/v2/error-envelope.schema.json` · conformance: `v2-min-client-version.test.ts` (decisions 4 and 5) and one new scenario, `v2-client-version-header.test.ts` · `openwop-sdks` (each v2 SDK sends the header) · extends RFC 0172 §A.5 |
| **Compatibility** | `additive` — a new optional request header (`COMPATIBILITY.md` §2.1) and new normative requirements on previously undefined behavior (§4). Measured against all three certified v2 hosts: none refuses a request without the header; two refuse a malformed value today and would change one line each (§Compatibility) |
| **Supersedes**    | — extends RFC 0172 §A.5; RFC 0172 stands                        |
| **Superseded by** | —                                                               |

## Summary

RFC 0172 §A.5 made `minClientVersion` (axis 15) first-class and let a host refuse a client below it with `426 client_version_unsupported`. Nothing in v2 says how the host learns the client's version. The three certified v2 hosts and the suite already use a header for it, `OpenWOP-Client-Version`, which no v2 document declares. This RFC declares it: optional on every operation, grammar `<major>.<minor>[.<patch>]`, compared with `minClientVersion` on major and minor only. A host may answer `426` only to a well-formed value below the floor. A request without the header, or with a malformed one, is served as though no version were announced.

## Motivation

**The refusal has no input.** `spec/v2/core/versioning.md` §1.5 says a host that advertises `minClientVersion` "MAY refuse a client below it", and that the refusal "MUST be `426` `client_version_unsupported`". v2 names no way for a client to state its version, so "below it" is undefined. v1 did name one: `spec/v1/version-negotiation.md` §"Minimum required `Capabilities` fields" lets a server reject "clients reporting `User-Agent: openwop-sdk/<v>` below `minClientVersion`". v2 dropped that sentence and put nothing in its place.

**The protocol already uses an undeclared header.** `spec/v2/core/headers.md` says "a header not listed here is not part of the protocol". Yet `conformance/src/scenarios/v2-min-client-version.test.ts` sends `OpenWOP-Client-Version: 0.0.1`, and its header comment says the header "is not yet declared in `api/v2/openapi.yaml` / `headers.md`". Every certified v2 host reads it. Measured from `evidence/v2-host-bundles/` on 2026-09-27:

| Host (bundle) | `minClientVersion` advertised | `openwop.requirement.0172.min-client-version` | How the host reads the header |
| --- | --- | --- | --- |
| MyndHyve (`myndhyve.json`, build `e609c637`) | `"0.1"` | `executed-pass`, 3 assertions | `v2Mount.ts`: full-match `<major>.<minor>[.<patch>]`, compares major then minor, **malformed is served** |
| openwop-app (`openwop-workflow-engine.json` and its 2.41.x / 2.42.2 cuts) | `"1.0"` | `executed-pass`, 3 assertions | `protocolVersion.ts`: prefix-match `<major>.<minor>`, trailing text ignored, **malformed is read as `0.0` and refused**; checked only under major 2 |
| v2 reference host (`openwop-host-v2-reference.json`, build `03c0d97f`) | `"1.0"` | `executed-pass`, 3 assertions | `router.ts`: same prefix match, **malformed read as `0.0` and refused**; checked on every path, `/v1/` included |

Three assertions means the scenario saw a `426` with the registered code in the closed envelope, so each host read the header and refused `0.0.1`. The hosts agree on the name and on major.minor ordering. They disagree on the grammar and on a malformed value, and nothing in the corpus says which is right.

**The scenario's comparison is undefined.** It sends a three-part value (`0.0.1`) against a two-part floor (`"1.0"`, `"0.1"`). The axis-15 grammar is `<major>.<minor>` (versioning.md §2, "as #1"), so no text says how the two compare. It works only because every host happens to discard the patch.

**Who hits it.** A second SDK, or any client not written by a host's own team, has no way to learn the header's name, grammar or failure behavior except by reading a scenario. A host that picks a different header (or `User-Agent`, as v1 said) conforms to the letter and refuses nobody, so its advertised floor enforces nothing.

## Proposal

### §A. The header

A request MAY carry `OpenWOP-Client-Version`, naming the protocol version the client implements:

```
OpenWOP-Client-Version: <major>.<minor>
OpenWOP-Client-Version: <major>.<minor>.<patch>
```

Each part is a non-negative decimal integer with no leading zeros. After surrounding whitespace is removed, the value matches `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$`.

- **What the value names.** The corpus release the client is built against (`versioning.md` §4, "One release identity": the tag `v2.<minor>.<patch>`). A client built against `v2.42.7` sends `2.42.7` or `2.42`. It is not a product or package version: an SDK whose package version does not derive from the corpus tag sends the corpus version it implements, not its own.
- **Optional on every operation.** It is accepted wherever `OpenWOP-Version` is. Its presence alone never makes a request fail.
- **It never selects a contract.** `OpenWOP-Version` selects the major (§1.3). A host MUST NOT choose a major, or a representation, from `OpenWOP-Client-Version`.
- **Clients SHOULD send it.** A client SHOULD send it on every request served under major 2. Each v2 SDK sends the corpus version it implements.

### §B. The comparison

A client is **below** `minClientVersion` when its `(major, minor)`, compared as integers, is less than the floor's. The patch never decides.

- `1.9` is below `1.10` (integers, not strings).
- `2.3.0`, `2.3` and `2.3.99` are all equal to a floor of `2.3`, and none is below it.
- `1.99.0` is below `2.0`.

Why patch is ignored: the floor has the axis-1 grammar, `<major>.<minor>` (§1.5, axis 15). A corpus patch release carries no wire change (`COMPATIBILITY.md` §2.4 makes the minor the unit a consumer pins), so a patch cannot move a client across a floor. The optional third part exists so a client can send its corpus tag verbatim.

### §C. When a host may refuse

- **§C.1** A host MUST NOT answer `426 client_version_unsupported` unless the request carries a well-formed `OpenWOP-Client-Version` that is below the `minClientVersion` it advertises. So a request without the header, a request with a malformed value, a request at or above the floor, and every request to a host that advertises no floor are never refused on version grounds.
- **§C.2** A malformed value MUST be treated as absent. It MUST NOT produce a `400`. (The same rule `headers.md` gives `Accept-Language`: "a malformed value MUST NOT produce a 400".)
- **§C.3** Refusing a client below the floor stays a `MAY` (§1.5, unchanged). A refusal stays `426` `client_version_unsupported` in the closed error envelope (`spec/v2/errors.json`, unchanged).
- **§C.4** The value is a client's claim, not a credential. A host MUST NOT use it as an authentication or authorization input.

**Why a malformed value is served, not refused.** The floor gates clients that say who they are; it does not guess about ones that do not. A host that reads garbage as `0.0` turns a client-side formatting bug into an outage for that client, and a `400` does the same with a less useful code. Neither protects the host: a client that wants to be served can always omit the header (§C.1), so refusing a malformed value only punishes the clients that tried to announce themselves. MyndHyve already serves it ("a request that announces nothing — or something unparseable — is served: the floor gates clients that say who they are, it does not guess", `v2Mount.ts`).

### Proposed spec text (lands at `Active`)

This RFC does not state the rule; `spec/v2/core/versioning.md` owns axis 15 (§2, "Owner: this document"). At `Active`, §1.5 becomes:

> ### 1.5 Client precedence and `minClientVersion`
>
> When both majors are advertised, a v2 client MUST select the highest major it implements that the host lists. A v1 client (no header, `/v1/` paths) is unaffected.
>
> A client announces the protocol version it implements in the `OpenWOP-Client-Version` request header, as `<major>.<minor>` or `<major>.<minor>.<patch>` (non-negative integers, no leading zeros). The value is the corpus release the client is built against (§4), not a product version.
>
> - A client SHOULD send it on every request under major 2.
> - The header is optional on every operation and never selects a major (§1.3).
> - A value outside the grammar MUST be treated as absent, and MUST NOT produce a `400`.
> - The value is the client's claim. A host MUST NOT use it as an authentication or authorization input.
>
> `minClientVersion` (axis 15) is optional. When a host advertises it:
>
> - It MUST use the axis-1 grammar.
> - A client is below it when the client's major and minor, compared as integers, are less than the floor's. The patch never decides.
> - A host MAY refuse a client below it. A refusal MUST be `426` `client_version_unsupported`.
>
> A host MUST NOT answer `426` `client_version_unsupported` to a request that does not carry a well-formed `OpenWOP-Client-Version` below its advertised `minClientVersion`.

`headers.md` is generated from OpenAPI, so it gains its row from the OpenAPI change below.

### Wire changes

One optional request header, injected by `scripts/derive-v2-api.py` beside `OpenWOPVersion` and appended to every operation's `parameters` exactly as `OpenWOPVersion` is:

```diff
   components:
     parameters:
+    OpenWOPClientVersion:
+      name: OpenWOP-Client-Version
+      in: header
+      required: false
+      schema:
+        type: string
+      description: The protocol version the client implements (versioning.md §1.5). Compared with minClientVersion on
+        major and minor. A malformed value is treated as absent and MUST NOT produce a 400. Never selects a contract.
```

The schema carries no `pattern` (changed 2026-09-27, before `Active` merged): a host that validates requests against the OpenAPI document would otherwise answer `400` to a malformed value, which this RFC forbids. The grammar lives in the description and `versioning.md` §1.5. No schema, error code, status, event or discovery field changes. `426` is not added to each operation's `responses`, matching `406 protocol_version_unsupported`, which is declared in `versioning.md` §1.3 and `errors.json` rather than per operation.

### Examples

Host advertises `"minClientVersion": "1.0"`.

**Conforming.**

| Request header | Host answer |
| --- | --- |
| (absent) | served |
| `OpenWOP-Client-Version: 2.42.7` | served |
| `OpenWOP-Client-Version: 1.0.0` | served (equal on major.minor) |
| `OpenWOP-Client-Version: 0.0.1` | served, or `426 { "error": "client_version_unsupported", ... }` |
| `OpenWOP-Client-Version: banana` | served (treated as absent) |

**Non-conforming.**

- `OpenWOP-Client-Version: banana` answered `426` (read as `0.0`) or `400 validation_error`.
- `OpenWOP-Client-Version: 1.0.5` answered `426` because `"1.0.5" < "1.0"` was compared as strings or with the patch.
- A host with a floor of `1.10` refusing `1.10` or `1.10.3`: equal on major.minor is not below.
- A host with a floor of `1.10` serving `1.9.0` is conforming (refusal is a `MAY`), but one that computes `"1.9" > "1.10"` by string order and refuses `1.10` is not.
- A host that advertises no `minClientVersion` answering `426` to any request.
- A `426` whose body is `{ "error": "upgrade_required" }` (unregistered code), or a refusal with any status other than `426`.

### Security considerations

- **A claim, not a credential (§C.4).** Any client can send any value. The header is a compatibility signal for honest clients, like `User-Agent`. A floor is not an enforcement boundary: a client below it that omits the header is served (§C.1), by design.
- **No oracle beyond the floor.** The only thing a refusal discloses is that the announced version is below the floor, which `minClientVersion` in the discovery document already discloses.
- **Echoing the value.** Two of the three hosts echo the announced value in the `426` `message`. MyndHyve truncates it to 32 characters; the v2 reference host and openwop-app echo the whole trimmed value. The grammar makes a well-formed value short and inert, and only a well-formed value can be refused (§C.1), so a refusal echoes at most a short numeric string. A host should still bound what it writes to logs from any request header.
- **Caches.** A host that refuses varies its answer on this header. `426` is not cacheable by default (RFC 9111 §4.2.2), and a cached `200` served to a below-floor client costs nothing the floor was protecting, since the floor is advisory (§C.1). No `Vary` requirement is proposed.
- **Threat models.** No `SECURITY/threat-model-*.md` covers version negotiation, and none is needed for a header that neither authenticates nor selects. No invariant row is proposed.

## Compatibility

`additive`.

- **The header is optional** (`COMPATIBILITY.md` §2.1). A client that does not send it is served exactly as today, on every host (§C.1). An existing client needs no change.
- **§C.1's "absent is never refused"** is met by all three certified hosts: each checks the floor only when the header is present and non-empty.
- **§B's major.minor comparison** is met by all three: MyndHyve compares parsed integers; openwop-app and the reference host prefix-match `<major>.<minor>` and compare those.
- **§C.2's "malformed is treated as absent"** is met by MyndHyve and not by the other two, which read a malformed value as `0.0` and refuse it. That is behavior on input the spec never defined, and serving it is looser validation (`COMPATIBILITY.md` §4, rows 5 and 6: "looser validation accepting input that previously failed" and "a new normative requirement on a previously-undefined behavior" are both additive). The change is one line in each host (return "not below" instead of `'0.0'` when the match fails). Gap register G1 tracks it.
- **No certified row changes.** `openwop.requirement.0172.min-client-version` sends a well-formed `0.0.1` and stays `executed-pass` on all three hosts. The new rows (below) are new.
- **Axis 15's grammar is unchanged.** The floor stays `<major>.<minor>`. The header's optional patch is not a floor grammar.

## Conformance

**Existing coverage.** `v2-min-client-version.test.ts` (row `openwop.requirement.0172.min-client-version`, gated on `minClientVersion`): the floor's grammar, and the refusal's code and envelope when a host refuses `0.0.1`. It never sends a malformed value, an at-floor value, or no header while expecting service. `v2-version-header-honored.test.ts` and `dual-stack-negotiation` cover `OpenWOP-Version` only.

**Changes at `Active`.**

1. `v2-min-client-version.test.ts`: the header comment drops "not yet declared". Its `blocked` branch (a non-`2xx`, non-`426` answer) is a failure, since the header is declared: a host that answers `0.0.1` with some other `4xx` is refusing a declared header in an unregistered form (decision 4). When a refusal carries `details.minClientVersion`, it must name the advertised floor (decision 5).
2. New `v2-client-version-header.test.ts` (with its row in `conformance/scenario-majors.json`, without which it never runs), all legs against `GET /.well-known/openwop` under `OpenWOP-Version: 2.0`:
   - **Floor-exact leg** (gated on `minClientVersion`): send `<floor>` and `<floor>.0`. Neither may be `426`.
   - **Malformed leg** (gated on `minClientVersion`): send `not-a-version`, `1`, `01.0`, `1.0-rc.1`. None may be `426` or `400`. Control: the same request with `0.0.1`. If the control is served, the host does not exercise the refusal at all, and the leg records `inapplicable` (nothing the host refuses can be compared).
   - **No-floor leg** (hosts that advertise no `minClientVersion`): send `0.0.1`. It may not be `426`. The three certified hosts all advertise a floor, so this leg records `inapplicable` on each today.
   - **Absent leg**: on every host, a header-less request is never `426`; on a host whose control `0.0.1` is `426`, it is also served.
   - **Floor-exact leg**, as landed, also sends `<floor>.99` (the patch never decides) and requires each to be served, since the header's presence alone never makes a request fail (§A).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B patch never decides; at-floor is not below (`openwop.requirement.0219.floor-comparison`) | `<floor>` and `<floor>.0` are not answered `426` | the suite, unaided | witnessable — gated on `minClientVersion` |
| §C.1 absent is never refused (`openwop.requirement.0219.absent-not-refused`) | a header-less request is served where the same request with `0.0.1` is `426` | the suite, unaided | witnessable — gated on a host that refuses; on a host that serves `0.0.1`, nothing distinguishes the cases, so `inapplicable` |
| §C.1 no floor, no `426` (`openwop.requirement.0219.no-floor-no-refusal`) | a host advertising no `minClientVersion` does not answer `0.0.1` with `426` | the suite, unaided | witnessable — on hosts without a floor; none of today's three |
| §C.2 malformed is treated as absent, never `400` (`openwop.requirement.0219.malformed-not-refused`) | malformed values are neither `426` nor `400` | the suite, unaided | witnessable — gated on a host that refuses `0.0.1` (otherwise a served malformed value proves nothing) |
| §A a host MUST NOT choose a major or representation from the header | — | — | **unwitnessable as a whole.** The suite can compare a discovery representation with and without the header, but a host could vary something the suite does not read, so a pass would prove only the fields read. Not given a row; recorded here |
| §A a client SHOULD send it | — | — | unwitnessable by a host bundle: a SHOULD on clients, not hosts. Witnessed instead by each SDK's own tests (`openwop-sdks`) |
| §C.4 not an authentication or authorization input | — | — | **unwitnessable.** Varying the header and observing an authorization decision would need a host that grants on it; a conforming host gives no observable. Kept as a MUST because the header is trivially forgeable, and recorded here |

## Alternatives considered

1. **Parse `User-Agent`, as v1 did.** Rejected. `User-Agent` is a product token list (RFC 9110 §10.1.5) that intermediaries, runtimes and browsers rewrite or set, and a browser client does not control it reliably (browsers set their own, and some ignore a script-set value). Its token names a product, not a protocol version, and v1's `openwop-sdk/<v>` token is one vendor's product. No certified host parses it; all three read `OpenWOP-Client-Version`. `headers.md` also requires every non-standard header to be named `OpenWOP-<Name>`.
2. **Send the SDK's package version.** Rejected. Package versions of different SDKs have no ordering relation to one another or to a host's floor, so a floor could only mean something for one vendor's SDK. The floor has the protocol-version grammar (axis 15, "as #1"), and `versioning.md` §1.3 already reads it as a protocol minor ("what pins a minor is `minClientVersion` plus the additive rules"). The v2 TypeScript and Python SDKs are packaged as `2.3.0` while the corpus is at `2.42.x`, so the two numbers already differ.
3. **Carry the client version in `OpenWOP-Version`'s minor.** `OpenWOP-Version: 2.42` already has a minor that is "informational" (§1.3). Rejected: it would overload the one header that selects a contract with a second meaning, and a client that sends `2.0` to select the major (as every v2 SDK does) would be read as a `2.0` client and refused by any host with a `2.x` floor above `2.0`.
4. **Refuse a malformed value** (`400`, or `426` as two hosts do). Rejected in §C: the client can always omit the header and be served, so refusing a malformed value protects nothing and breaks clients that tried to comply.
5. **Compare the full three-part value**, with the floor gaining an optional patch. Rejected: it changes axis 15's grammar, which three hosts advertise, and a corpus patch has no wire change to gate on.
6. **Do nothing.** The scenario keeps using an undeclared header that `headers.md` says is not part of the protocol, a second host or SDK has to reverse-engineer the name from test code, and two hosts keep refusing clients over a formatting slip. The refusal RFC 0172 §A.5 made first-class stays without an input.

## Decisions

Decided by the maintainer on 2026-09-27, at the `Draft → Active` flip. Each was an Unresolved question in the `Draft`.

1. **What the value names** (was question 1). The protocol (corpus) release the client implements, `<major>.<minor>[.<patch>]`, compared on major.minor. It is not an SDK package version. §A stands as written; gap G2 is closed.
2. **`/v1/` paths** (was question 2). This RFC is silent on them. The frozen v1 text (`User-Agent`) governs `/v1/` requests during the overlap. `versioning.md` §1.5 says the header rule binds requests served under major 2. Gap G5 is closed.
3. **`Upgrade` on a `426`** (was question 3). Transferred to `spec/v2/core/versioning.md` §1.5, which records it as an open gap: the `426` floor departs from RFC 9110 §15.5.22's `Upgrade` MUST, and no `Upgrade` value is defined yet. Gap G3 records the transfer.
4. **The existing scenario's `blocked` branch** (was question 4). Once the header is declared, a non-`2xx`, non-`426` answer to a below-floor client is a failure in `v2-min-client-version.test.ts`, not `blocked`. Landed with the flip.
5. **`details.minClientVersion` on the refusal** (was question 5). Registered: `client_version_unsupported` carries OPTIONAL `details: { minClientVersion }`, the floor in the axis-1 grammar. Owned by `errors.md` and `spec/v2/errors.json`; the generated `schemas/v2/error-envelope.schema.json` now binds a registered `details` schema to its own code (`if error == code then details`). The previous `oneOf` over every registered schema plus an open fallback matched a conforming body twice, so any envelope carrying registered `details` failed validation. Gap G4 records the landing.
6. **Refusing the discovery document** (was question 6). Not exempt. A client refused at discovery learns the floor from `details.minClientVersion` (decision 5). `versioning.md` §1.5 says so.

## Unresolved questions

None open. See §Decisions.

## Implementation notes (non-normative)

All of this lands at `Active`, not in the filing PR, following the Draft convention of RFC 0215.

- **Spec.** `spec/v2/core/versioning.md` §1.5 takes the text in §Proposal. RFC 0172's header gains an `Amended by` row pointing here. A parallel corrections PR is fixing RFC 0172 §A.5's wording and adding a `pattern` to the `minClientVersion` schema; this RFC's text is written against the axis-15 grammar that PR pins and does not touch either surface.
- **OpenAPI.** `scripts/derive-v2-api.py`: add `OpenWOPClientVersion` to `comps['parameters']` beside `OpenWOPVersion` (around line 375), and append its `$ref` wherever `OpenWOPVersion`'s is appended (around line 491). Regenerate `api/v2/openapi.yaml` and `spec/v2/core/headers.md` with `python3 scripts/derive-v2-api.py --write`; `redocly lint` must stay clean.
- **Conformance.** §Conformance. New requirement ids under `openwop.requirement.0219.*`; regenerate `scenario-majors.json` and the requirement registry; sabotage-prove each leg under `OPENWOP_TARGET_MAJOR=2` against the v2 reference host by reverting it to "malformed reads as `0.0`".
- **Hosts.** The reference host (`openwop-examples`, `router.ts` ~l.209) and openwop-app (`protocolVersion.ts` ~l.729) replace the `'0.0'` fallback with "not below", and use a full-match grammar so `1.0-rc.1` is malformed rather than `1.0`. MyndHyve already conforms.
- **SDKs.** Each v2 SDK in `openwop-sdks` sends `OpenWOP-Client-Version: <corpus major.minor>` on every request, next to `OpenWOP-Version`, and `sdk/PARITY.md` gains the row. None sends it today.
- **Effort.** Small: one spec paragraph, one generator line pair, one scenario, two one-line host fixes, three SDK header additions.

## Acceptance criteria

- [x] `Active`: `versioning.md` §1.5 text and the OpenAPI header merged; `v2-client-version-header.test.ts` in the suite with its `scenario-majors.json` row, each leg sabotage-proved (2026-09-27, against a stub host implementing §1.5 exactly and one sabotage per leg; suite 2.42.8).
- [x] `Active`: Unresolved questions 1, 2 and 4 decided; 3, 5 and 6 decided or transferred to their owning doc (§Decisions, 2026-09-27).
- [ ] `Active`: the v2 reference host and openwop-app measured on the malformed leg before it ships (gap G1, risk R1). Waiting on the two host PRs (`openwop-examples` v2 reference, openwop-app); the Active PR does not merge until both are measured.
- [ ] `Accepted`: `openwop.requirement.0219.floor-comparison`, `.absent-not-refused` and `.malformed-not-refused` `executed-pass` on a certified host bundle.
- [ ] `Accepted`: at least one v2 SDK sends the header, with a test pinning the corpus version it sends (gap G6, risk R3).
- [ ] CHANGELOG entry at each status flip.

## References

- RFC 0172 §A.5 and row C5.8 (`minClientVersion` first-class; `426 client_version_unsupported`).
- `spec/v2/core/versioning.md` §1.3, §1.5, §2 (axis 15), §4; `spec/v2/core/headers.md`; `spec/v2/errors.json` (`client_version_unsupported`).
- `spec/v1/version-negotiation.md` §"Minimum required `Capabilities` fields" (the v1 `User-Agent` sentence).
- `conformance/src/scenarios/v2-min-client-version.test.ts`.
- `evidence/v2-host-bundles/myndhyve.json`, `openwop-workflow-engine.json`, `openwop-host-v2-reference.json`.
- RFC 9110 §10.1.5 (`User-Agent`), §15.5.22 (`426 Upgrade Required`); RFC 9111 §4.2.2 (heuristic cacheability).
- `COMPATIBILITY.md` §2.1, §2.4, §4.
