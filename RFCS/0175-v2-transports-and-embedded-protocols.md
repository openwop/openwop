# RFC 0175: v2 transports and embedded protocols — gRPC demoted or generated, the legacy A2A and MCP profiles gone, negotiation authenticated with a minimum-version policy, the interop threat model written

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0175                                                            |
| **Title**         | v2 transports and embedded protocols: `grpc-transport.md` leaves `core/` for `spec/v2/ext/grpc-transport/` with `witness: unwitnessable` and `adoption: none` unless the proto is generated from the C.2 declaration file and the suite gains a client (decided: demoted); `supportedTransports` is deleted — A2A and MCP are compositions with first-class blocks, not transports; the `a2a-0.3-legacy` and `mcp-2025-06-18-legacy` profiles are absent from the v2 tree at the cut with the adopter inventories recorded as measured (one dual-era host each); version negotiation on both embedded protocols is authenticated, carries an advertised minimum-version policy and a refresh SLA (RFC 0147 R10), and emits a content-free `negotiation.decided` event (RFC 0152/0153 G7); MRTR rounds get a normative ceiling (RFC 0153 G9); the `auth-required` projection under durable tasks is decided (RFC 0100 UQ4); `SECURITY/threat-model-interop.md` is written (RFC 0152/0153 G8) |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167 (identity and authorization at the peer boundary). Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C8.** v2 (Phase 3): `spec/v2/ext/grpc-transport/` (demoted; `api/grpc/openwop.proto` retired from `api/v2/` unless generated), `schemas/v2/capabilities.schema.json` (`supportedTransports` removed; `a2a`/`mcp` facets with `versions[]`/`revisions[]`, `preferredVersion`, `minimumVersion`, `refreshedAt`; `-legacy` profile patterns removed; `mcp.mrtr.maxRounds`), `spec/v2/core/interop.md` (NEW: negotiation, minimum-version policy, refresh SLA, the audit event), `schemas/v2/run-event.schema.json` (`negotiation.decided`), NEW `SECURITY/threat-model-interop.md`; the suite's dual-era A2A peer and MCP server lose their legacy halves; v1.x (this PR): `spec/v1/migrations.json` rows `openwop.migration.C8.1`–`C8.8`; the RFC 0152/0153 registers gain the G7/G8/G9 rows that existed only in the spec docs; codemod `openwop.codemod.discovery-document-v2` extended (legacy ids and `supportedTransports`); deprecation row `supported-transports-field` (`proposed`); `grpc-transport.md:202`'s stale "in flight" sentence corrected (editorial) |
| **Compatibility** | `breaking` (v2). In v1.x this PR changes no wire shape; two registers gain rows their own spec docs already carried, and one stale forward reference is corrected |
| **Supersedes**    | — (RFC 0094 §H, 0100, 0152, 0153 remain the v1 authorities; the legacy-window dates they set stand) |
| **Superseded by** | —                                                               |

## Summary

`grpc-transport.md` is Stable with six MUSTs, a proto that calls itself abridged and defers its own messages to a v1.x that never came, no client in the suite, and zero advertisers — Axiom 1's exact failure. `supportedTransports` lists one baseline, one real transport nobody serves, and two embedded protocols that have richer first-class blocks; nothing reads its `mcp` or `a2a` members. The legacy A2A 0.3 and MCP 2025-06-18 profiles have dated sunsets (2027-03-12, 2027-08-12), one dual-era advertiser each, and removal recorded as "a v2 change." Version negotiation on both protocols is fail-closed only for an already-authenticated request, has no minimum-version policy in normative text, no refresh SLA, no audit event, and no threat model; its only witness is a seam a production host never mounts. v2 demotes gRPC, deletes `supportedTransports`, removes the legacy profiles at the cut, makes negotiation authenticated with an advertised floor, a refresh SLA, a ceiling on MRTR rounds and a content-free audit event, and writes the threat model both Stable documents cite.

## Motivation

- `grpc-transport.md:3` Stable; `api/grpc/openwop.proto:14–20, 68–72` "abridged … deferred to v1.x … a future v1.x minor expands every Struct"; `conformance/src/scenarios/grpc-transport.test.ts:5` "SHAPE-ONLY by design … the suite ships no gRPC client"; `grpc-transport.md:202` still says RFC 0094 is "in flight"; `extensions.json:662` `draft`, `witnessable-gated` on a scenario that dials nothing; no `grpc` in INTEROP-MATRIX.
- `capabilities.schema.json:370` `supportedTransports: ["rest","mcp","a2a","grpc"]`; `profiles.md:86/102` read only `rest`; `a2a-integration.md:3` and `mcp-integration.md:3` describe compositions, not transports; `a2a` carries its own transport list inside its block (G4) and `mcp.serverMount.transports` is its own enum.
- Legacy windows: `a2a-integration.md:333` (2027-03-12; "Removal of the 0.3 code path from the corpus is a v2 change"), `mcp-integration.md:251` (2027-08-12; same); RFC 0152 G1 / 0153 G1 measured: one dual-era advertiser each (openwop-app), no reference host advertises versions; the `-legacy` suffix is baked into both `profiles` item patterns (`capabilities.schema.json:2908, 3400`), so removal is a pattern change; `mcp-integration.md:316` lists the legacy-profile scenarios the cut deletes.
- Negotiation: `a2a-integration.md:341` and `mcp-integration.md:260` — "for an authenticated request the default is fail-closed"; the exchange itself is not required to be authenticated; "minimum-version policy" exists only as a mitigation phrase in RFC 0152/0153 R1; the refresh SLA is RFC 0147 R10, unwritten; the audit event is RFC 0152/0153 G7 (`authorization.decided` as carrier, no dedicated type); `host-sample-test-seams.md:954` — the wire toward a peer is "what no black-box request to the host's own API can observe," so both R1 rows are `blocked` on every host.
- `mcp-integration.md:283` "the host MUST bound the number of rounds (host policy)" — a MUST with no number (G9). RFC 0100 UQ4 — `auth-required` in the persisted `A2ATaskState` enum for the reverse direction, never emitted forward.
- `SECURITY/threat-model-interop.md` does not exist; `a2a-integration.md:509` and `mcp-integration.md:331` (G8) cite it; the G7/G8/G9 rows live only in the spec docs — the RFC registers stop at G7 and G5.

## Proposal

### §A. gRPC

**§A.1** `grpc-transport.md` moves to `spec/v2/ext/grpc-transport/` with header `witness: unwitnessable` (the suite ships no client) and `adoption: none`; its six MUSTs become SHOULDs of the extension; `api/grpc/openwop.proto` is retired from the canonical API set (`api/v2/` carries OpenAPI and AsyncAPI only) and kept under `ext/grpc-transport/openwop.proto` as a non-normative sketch. **If** a Phase 3 contributor generates the proto from the C.2 declaration file and lands a suite client, the extension re-enters `core/` by a v2.x additive RFC — the door is named, not left ajar. The `capabilities.grpc` block is removed from the closed root (an unwitnessable family may not be advertised, RFC 0169 §A.1); `grpc-transport.md:202`'s "in flight" sentence is corrected now (editorial).

### §B. `supportedTransports` is deleted

**§B.1** REST is the wire; there is no transport advertisement. A2A and MCP are **compositions** advertised by their own facets (`a2a.versions[]`, `a2a.preferredVersion`, `a2a.minimumVersion`, `a2a.profiles[]` without `-legacy`; `mcp.revisions[]`, `mcp.preferredVersion`, `mcp.minimumRevision`, `mcp.features[]`, `mcp.serverMount.transports[]`). RFC 0172 §B axes 11–12 are these facets.

### §C. Legacy profiles gone at the cut

**§C.1** `a2a-0.3-legacy` and `mcp-2025-06-18-legacy` do not exist in the v2 tree: the `profiles[]` item patterns lose the `(-legacy)?` alternative; the legacy code paths (`a2a-integration.md` §0.3 mapping, `mcp-integration.md` live-callback bridges) are absent from `spec/v2/`; the suite's dual-era A2A peer and MCP server lose their legacy halves; the four `mcp-server-*` legacy scenarios are deleted. The v1 sunset dates (2027-03-12, 2027-08-12) stand for the v1 tree through Phase 5. **§C.2** The adopter inventories (RFC 0152 G1, 0153 G1) are closed as measured: one dual-era advertiser (openwop-app), no reference host; a third-party inventory is not obtainable and the RFCs say so. **§C.3** The header-less card rule (`a2a-integration.md:349`) becomes unconditional: a v2 host serves the card of `preferredVersion` when no `A2A-Version` header is present.

### §D. Negotiation is a protocol

**§D.1** A version-negotiation exchange on either embedded protocol MUST be **authenticated**: the peer identity is the C.3 Subject of the caller (or the host's own outbound identity), and an unauthenticated negotiation MUST NOT lower the version below `preferredVersion`. **§D.2** A host advertises `minimumVersion` (A2A) / `minimumRevision` (MCP); a negotiation that would land below the floor MUST fail closed (`interop_version_unsupported`, RFC 0152 §B's code, registered in C.4's `errors.json`) whether or not a policy permits explicit downgrade above the floor. **§D.3** Every negotiation outcome — including the fail-closed one — emits **`negotiation.decided`** (new v2 event type: `{ protocol: a2a | mcp, peer: <origin digest>, requested, negotiated | null, outcome: accepted | downgraded | refused, reason }`, content-free), replacing the `authorization.decided` carrier RFC 0152/0153 G7 recommended. **§D.4** Refresh SLA (RFC 0147 R10): a host MUST re-evaluate its advertised `versions[]` / `revisions[]` against the upstream registry within an advertised `refreshedAt` window not exceeding 90 days; an advertisement older than its window is non-conformant. **§D.5** The silent-downgrade invariants (`a2a-version-no-silent-downgrade`, `mcp-version-no-silent-downgrade`) are witnessed by the `negotiation.decided` event on the host's own event log — a normative surface — rather than only by the §22/§23 invoke seams; the seams stay in the C.1 seams profile for the wire-capture leg.

### §E. MRTR and the durable-task projection

**§E.1** `mcp.mrtr.maxRounds` (integer, 1–16, advertised) is the ceiling; the host MUST refuse a further `input_required` round beyond it (`mcp_mrtr_rounds_exceeded`, registered in `errors.json`); RFC 0153 G9 closes. The `requestState` MUSTs (`mcp-integration.md:290–291`) carry over unchanged. **§E.2** RFC 0100 UQ4: `auth-required` stays in the persisted `A2ATaskState` enum for the reverse direction; the forward projection never emits it in v2 either — v2 has no `auth` interrupt kind, and inventing one here would be C.4's business; recorded as decided, not deferred (RFC 0152 G9 closes as "not in v2.0").

### §F. The threat model

**§F.1** `SECURITY/threat-model-interop.md` is written with the sibling template (§1–§8): downgrade, card/runtime drift, cross-tenant lookup through a peer, artifact leakage across the boundary, the anonymous end-user actor (RFC 0165 §B.6), and negotiation replay; its §5 invariants are the two silent-downgrade rows plus `interop-negotiation-authenticated`, `interop-minimum-version-enforced`, `interop-peer-no-authority-escalation` (already registered) — entering `invariants.yaml` with their tests in Phase 3 (RFC 0167 §C rule). RFC 0152 G8 and 0153 G8 close when the file exists.

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C8.1` | remove | `a2a-0.3-legacy` / `mcp-2025-06-18-legacy` profiles and the `(-legacy)?` patterns | none | `openwop.codemod.discovery-document-v2` (strips the ids and the legacy version when `preferredVersion` is not legacy; refuses when it is) | not-persisted |
| `openwop.migration.C8.2` | remove | `supportedTransports[]` | none — REST is the wire; A2A/MCP are facets | `openwop.codemod.discovery-document-v2` | not-persisted |
| `openwop.migration.C8.3` | remove | `capabilities.grpc` block; `grpc-transport.md` in core | `spec/v2/ext/grpc-transport/` (`unwitnessable`, `adoption: none`); block not advertisable | `openwop.codemod.discovery-document-v2` (drops the block) | not-persisted |
| `openwop.migration.C8.4` | add | none | `a2a.minimumVersion`, `mcp.minimumRevision`, `refreshedAt` | — | not-persisted |
| `openwop.migration.C8.5` | add | `authorization.decided` as the recommended carrier | `negotiation.decided` event type | — (a new event; v1 logs carry none) | not-persisted |
| `openwop.migration.C8.6` | behavior | negotiation fail-closed only for authenticated requests; no floor; no SLA | authenticated exchange, floor, 90-day refresh SLA | — | not-persisted |
| `openwop.migration.C8.7` | add | "the host MUST bound the number of rounds (host policy)" | `mcp.mrtr.maxRounds` + `mcp_mrtr_rounds_exceeded` | — | not-persisted |
| `openwop.migration.C8.8` | behavior | `auth-required` never emitted forward; UQ4 open | decided: stays reverse-only; no v2 `auth` interrupt kind | — | unchanged (persisted `A2ATaskState` rows keep the enum member) |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| Persisted A2A task state (openwop-app) | `A2ATaskState.state` incl. `auth-required` | unchanged |
| Event logs | no negotiation events under v1 | not-persisted (new type from the cut) |
| Discovery documents | legacy profile ids, `supportedTransports`, `grpc` block | not-persisted; the codemod rewrites a captured document |
| Suite fixtures (dual-era peer/server) | legacy halves | removed with suite 2.0.0 (C.1) |

## Compatibility

`breaking` (v2). This PR changes no v1.x wire shape. The RFC 0152/0153 register additions copy rows that already exist in the spec documents' own gap tables (register drift, RFC 0174 §C); the `grpc-transport.md:202` correction is editorial (RFC 0094 is Accepted).

## Conformance

v2 scenarios (suite 2.0.0): `no-transport-advertisement` (unaided: `supportedTransports` and `grpc` absent), `legacy-profiles-absent` (unaided: no `-legacy` id validates), `negotiation-decided-emitted` (gated on `a2a`/`mcp`: the host's own event log carries `negotiation.decided` for a peer exchange driven through the seams profile), `minimum-version-refused` (gated: a peer offering below the floor is refused with `interop_version_unsupported` and the event says `refused`), `negotiation-authenticated` (gated: an unauthenticated exchange cannot lower the version), `refresh-sla` (unaided: `refreshedAt` within the window), `mrtr-rounds-ceiling` (gated on `mcp`: round `maxRounds + 1` refused), `threat-model-template` (corpus, shared with C.6).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 no `grpc` block; ext header declares class | discovery + corpus | the suite, unaided; the corpus gate | witnessable — unaided |
| §B.1 no `supportedTransports` | discovery | the suite, unaided | witnessable — unaided |
| §C.1 no `-legacy` id | discovery schema | the suite, unaided | witnessable — unaided |
| §D.1 unauthenticated exchange cannot downgrade | event log + peer capture | the suite via the C.1 seams profile | seam-gated |
| §D.2 floor refused | `interop_version_unsupported` + event | the suite via the seams profile | seam-gated |
| §D.3 `negotiation.decided` on every outcome | the host's event log | the suite, gated on `a2a`/`mcp` (the exchange is driven through the seam, the event is read on the normative surface) | witnessable — gated |
| §D.4 refresh SLA | `refreshedAt` | the suite, unaided | witnessable — unaided |
| §E.1 MRTR ceiling | refusal at `maxRounds + 1` | the suite's fake MCP server, gated | witnessable — gated |
| §F.1 threat model present with the template | corpus gate | the corpus gate | witnessable — unaided (corpus) |

## Adversarial review

1. **Demoting gRPC to `unwitnessable` while a `grpc` block exists in the schema contradicts RFC 0169 §A.1.** Disposition: the block is removed from the v2 root (row C8.3); a demoted extension is documented, not advertised.
2. **Deleting `supportedTransports` removes the one field that let a client learn REST is served.** Disposition: REST is the wire by definition (`grpc-transport.md:3` already says "REST + SSE remains the REQUIRED wire surface"); a field that can only say `rest` says nothing.
3. **Removing the `-legacy` pattern before 2027-03-12 / 2027-08-12 breaks the v1 promise.** Disposition: it does not — the v1 tree keeps the profiles and the dates through Phase 5; only `spec/v2/` lacks them, and a v2 host that still speaks A2A 0.3 does so as a non-advertised private behavior, which is what "removed from the corpus" means.
4. **Authenticated negotiation is unwitnessable without the invoke seams.** Disposition: the *exchange* is driven through the C.1 seams profile, but the *record* (`negotiation.decided`) lands on the host's own event log, a normative surface; §D.3's leg is `witnessable — gated`, §D.1/§D.2's peer-capture legs stay honestly `seam-gated`.
5. **A 90-day refresh SLA is arbitrary.** Disposition: it is the shortest window both upstreams' own lifecycle policies exceed (A2A/MCP twelve-month deprecation minimums); recorded as G1 for re-measurement at the first refresh.
6. **RFC 0100 UQ4 is "decided" by not deciding.** Disposition: the decision is that v2.0 has no `auth` interrupt kind; a future additive RFC may add one; the enum member stays for reverse-direction fidelity; RFC 0152 G9 closes as "not in v2.0", which is a decision with a date.
7. **The RFC 0152/0153 registers lack the G7–G9 rows the charter cites.** Disposition: copied into the registers in this PR with the spec-doc rows as their sources (RFC 0174 §C register-drift rule); the spec docs' tables are retired into `gaps.json` in Phase 3 (RFC 0174 §E.3).

## Alternatives considered

1. Generate the proto now and keep gRPC in core. Rejected: no client, no advertiser, and the declaration file (C.2) does not exist until Phase 3; the door is named in §A.1.
2. Keep `supportedTransports` as `["rest"]`. Rejected: Axiom 2 — a field with one legal value is an alias for its own absence.
3. Keep the legacy profiles through the v1 dates in `spec/v2/`. Rejected: the dates are v1's; v2 starts without the code paths, as both RFCs already say.
4. Do nothing. Rejected: two Stable documents cite a threat model that does not exist.

## Unresolved questions

1. Whether `negotiation.decided` should carry the peer origin in clear or as a digest. Recommended: digest (content-free audit, RFC 0128 purpose label rides separately).

## Implementation notes (non-normative)

openwop-app advertises both eras of both protocols today and drops the legacy halves in Phase 4; MyndHyve advertises neither A2A nor MCP versions and has no obligation under §D. The suite's fake peer and server (`a2a-fake-peer.ts`, `mcp-fake-server.ts`) are the `negotiation-decided-emitted` drivers.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; rows `C8.1`–`C8.8`; the discovery codemod extended with fixtures; RFC 0152/0153 register rows G7–G9 added; `grpc-transport.md:202` corrected; deprecation row `supported-transports-field`; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `spec/v2/ext/grpc-transport/`; the facets and patterns in `schemas/v2/capabilities.schema.json`; `spec/v2/core/interop.md`; `negotiation.decided` in the v2 event registry; `SECURITY/threat-model-interop.md`; the eight scenarios in suite 2.0.0; openwop-app passes `no-transport-advertisement`, `legacy-profiles-absent`, `negotiation-decided-emitted`, `refresh-sla`.

## References

- RFC 0167 §A (Axioms 1–2), §C, §E.1 axes 11–12, §E.3; RFC 0094 §H; RFC 0100 UQ4; RFC 0152 §B, G1, G3, G7–G9, R1; RFC 0153 §A/§C, G1, G3, G7–G9, R1; RFC 0147 G11, G12, R10; RFC 0169 §A.1; RFC 0171 §A/§B; RFC 0172 §B; RFC 0165 §B.6.
- `spec/v1/grpc-transport.md`, `api/grpc/openwop.proto`; `spec/v1/a2a-integration.md` §Discovery, §B, §Open spec gaps; `spec/v1/mcp-integration.md` §B, §C.1, §Open spec gaps; `spec/v1/host-sample-test-seams.md` §22–§23; `spec/v1/capabilities.md:162`; `schemas/capabilities.schema.json` (`supportedTransports`, `a2a`, `mcp`, `grpc`); `conformance/src/scenarios/grpc-transport.test.ts`; `SECURITY/threat-model-*.md` (the template).
