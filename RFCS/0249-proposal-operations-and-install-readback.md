# RFC 0249: v2 proposal operations and a verifiable install read-back

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0249                                                            |
| **Title**         | Normative v2 operations for RFC 0096 proposals, a client-submitted draft, and an install read-back the suite can byte-compare |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-24                                                      |
| **Updated**       | 2026-10-24 — **`Active → Accepted`**; RFC 0156 §B review deferred by steward exemption (2026-10-17). Evidence tier: tier-1 — openwop-app's certified 2.46.21 production cut 209c (build `commit:34bfefddc`, revision `openwop-app-backend-01032-9ff`, 480/0/0, `--verify --host-key` VERIFIED) advertises `agents.proposals {artifactKinds: [prompt-template], activation: direct-rbac, clientDrafts, readback: [prompt-template]}` and records all nine `0249.*` host and shape legs `executed-pass` (39 assertions), as pre-registered. G1 closes. · 2026-10-24 — **`Draft → Active`, comment window waived by the maintainer** (user instruction 2026-10-24: "waive the 7 day window for 0249"); STEWARD OVERRIDE of RFC 0147 §A.6 recorded in `MAINTAINERS.md`. UQ 1–5 resolved by `/architect` with openwop-app's measured constraints (ADR 0938): a third scope `proposals:apply`; an optional `artifactDigest` apply binding with `409 proposal_stale`; `approval-gate` apply opens a gate run; `readback` stays a separate array; `proposal_state_conflict` registered; only `meta` is host-owned; the read-back is tenant-scoped and `installedArtifact.id` is the artifact's `templateId`. Host half: openwop-app (ADR 0970). · 2026-10-24 — Draft, from the `/architect` ruling on RFC 0096's v2 gap. |
| **Affects**       | `api/openapi.yaml` → `api/v2/openapi.yaml` (seven operations, tag `proposals`) · `spec/v2/path-manifest.json` (generated) · `spec/v2/facets/agents.schema.json` `proposals` (optional `clientDrafts`, `readback`) · `schemas/v2/proposal.schema.json` (optional `activation.installedArtifact`, `artifactDigest`; the file leaves the v1 seed set) · new `schemas/v2/proposal-submit.schema.json`, `proposal-revise.schema.json`, `proposal-apply.schema.json`, `proposal-list-response.schema.json` · `spec/v2/errors.json` (`proposal_state_conflict`, `proposal_stale`, `proposal_install_conflict`) · scopes `proposals:read`, `proposals:write`, `proposals:apply` · `spec/v2/core/execution.md` (a one-line pointer, word-neutral) · `spec/v2/core/security-defaults.md` (one obligation row) · `SECURITY/invariants.yaml` (`proposal-inert-until-applied`, `proposal-no-resynthesis`: v2 tests, witness class) · conformance: `v2-proposal-lifecycle.test.ts` · CHANGELOG · openwop-sdks (follow-up) |
| **Compatibility** | `additive`                                                      |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0096 makes a host-synthesized reusable artifact inert until an authorized principal applies it, and requires the installed artifact to byte-match the reviewed draft. At v2 neither rule can be observed: the facet says "v2 defines no protocol path for the proposal surface", and the only test drives a v1 sample seam that no longer runs. This RFC mints seven normative v2 operations for the proposal lifecycle, lets a client submit a draft so the suite can create one it controls, and replaces the opaque `installedArtifactRef` with a closed `installedArtifact` that names the v2 read operation serving the installed bytes. Byte-match becomes RFC 8785 (JCS) equality against that read. Phase 1 covers `prompt-template`, the one proposal kind that already has a v2 read surface.

## Motivation

RFC 0096 went `Accepted → Active` on 2026-10-19 (#2025, #2026) because neither witness showed an install: openwop-app returned a hash as `installedArtifactRef` and installed nothing, and MyndHyve's evidence was an unscoped-apply `403`. Its `Updated` line names the repository work owed before it can be Parked: behavioral legs for inertness and no re-synthesis, the success half of apply, and a way to read an installed artifact back.

That work cannot be done at v2 today:

- `spec/v2/facets/agents.schema.json` `proposals` states both MUSTs and says v2 defines no protocol path.
- `api/v2/openapi.yaml` has no proposal operation.
- `SECURITY/invariants.yaml` marks `proposal-inert-until-applied` (protocol tier, critical) and `proposal-no-resynthesis` (protocol tier, high) `seam-gated`, and cites only `proposal-reviewable-learning.test.ts`, a v1 scenario. v2 declares no proposal seam.

`spec/v2/core/conformance.md` §Witness class requires a MUST whose only witness is `seam-gated` to mint a normative observation path or be demoted to SHOULD. Demoting is a relaxed MUST (`COMPATIBILITY.md` §2.2) on the guarantee that an agent cannot silently change its own production behavior, so it is not available within v2. This RFC mints the path.

The suite cannot make a host synthesize a proposal from its own traces on demand, so the synthesis half of RFC 0096 stays host-internal. Inertness and byte-match do not depend on who wrote the draft. A client-submitted draft is held to the same rules, and the suite can author one whose bytes it knows.

## Proposal

### §A — Operations

All seven are unversioned paths under the `proposals` tag, gated on the `agents.proposals` facet. A host that does not advertise it MUST answer every one `404 not_found`, as `errors.md` §Unadvertised operations requires of every unadvertised operation.

| Operation | Method + path | Scope | Notes |
| --- | --- | --- | --- |
| `listProposals` | `GET /proposals?state=&kind=` | `proposals:read` | Paginated `{items, nextCursor?}`, scoped to the caller's tenant and workspace. |
| `getProposal` | `GET /proposals/{proposalId}` | `proposals:read` | One `Proposal`, including the inert `artifact`. |
| `submitProposal` | `POST /proposals` | `proposals:write` | Only when the facet advertises `clientDrafts: true`; otherwise `404 not_found`. Body `proposal-submit` → `201` with the `Proposal` in `draft`. |
| `reviseProposal` | `PATCH /proposals/{proposalId}` | `proposals:write` | Body `proposal-revise`; sets `state: revised`. MUST NOT activate. |
| `applyProposal` | `POST /proposals/{proposalId}:apply` | `proposals:apply` | Optional body `proposal-apply`; §C. |
| `rejectProposal` | `POST /proposals/{proposalId}:reject` | `proposals:write` | `state: rejected`; optional `{reason}` (redaction-safe). |
| `archiveProposal` | `DELETE /proposals/{proposalId}` | `proposals:write` | Soft: `state: archived`. |

**States.** `applied`, `rejected` and `archived` are terminal. Revise, apply or reject on a terminal proposal MUST be refused `409 proposal_state_conflict` with `details {state, action}`. Archive is accepted from `draft`, `revised` and `rejected`; on `applied` or `archived` it is refused `409 proposal_state_conflict`. Archiving uninstalls nothing, and `archived` means terminal-inert, so an applied proposal is never relabelled as one. Removing an installed artifact goes through its own store (for `prompt-template`, `deletePromptTemplate`). A revise that loses a concurrent update MUST be refused `409 proposal_stale`.

**Scopes.** `proposals:read`, `proposals:write` and `proposals:apply` are new scope vocabulary. Submitting, revising, rejecting and archiving a draft share `proposals:write`: a draft is inert, so authoring and revising carry the same risk. Activation has its own scope so a host can let a reviewer revise without letting them install.

A proposal is owned by the RFC 0048 triple in `owner`. A host MUST NOT list, return, revise, apply, reject or archive a proposal for a caller outside that tenant, and MUST answer such a request exactly as it answers an id that does not exist (`404`), so the operation is not an existence oracle.

### §B — Client-submitted drafts

`agents.proposals` gains one optional member, `clientDrafts: boolean` (default `false`). When `true`, `submitProposal` accepts `{kind, artifact, title?, rationale?}`. The host:

- MUST validate `kind` against the advertised `artifactKinds` (`400 validation_error`, `details.field: kind`);
- MAY validate `artifact` against the kind's own schema at submit, and MUST at apply (RFC 0096 G5: `422` on mismatch);
- MUST set `provenance.sourceRunIds: []` and MUST NOT invent run provenance;
- MUST treat the result exactly as a synthesized draft. Every RFC 0096 rule applies, and inertness first among them.

### §C — Apply and the install read-back

`applyProposal` routes through the facet's `activation`, as RFC 0096 §E.2 already requires:

- `direct-rbac`: the caller MUST hold `proposals:apply`. Without it the host answers `403` with `error="insufficient_scope"` (`identity.md`), installs nothing, and leaves `state` unchanged.
- `approval-gate`: the host answers `202 {runId}` for a host-owned gate run that suspends on an `approval` interrupt with `data.artifactType: "proposal"` and `data.artifactId` the proposal id. Every `interrupt.md` §Approval rule applies unchanged: quorum, rejection, timeout and replay. On `accept` the host installs, sets `state: applied`, and the run completes. On a rejection or a timeout it installs nothing, the proposal's `state` is unchanged, and the run fails `approval_rejected`. No interrupt is raised outside a run.

**Binding to what was reviewed.** The optional body `proposal-apply` is `{artifactDigest}`: `"sha256:"` followed by the lowercase hex SHA-256 of the RFC 8785 (JCS) serialization of the proposal's `artifact`. `getProposal` serves the same value as `artifactDigest`.

- A host MAY require the binding. It then refuses an apply without it with `400 validation_error`, `details.field: artifactDigest`.
- When a digest is sent and differs from the persisted artifact's, the host MUST refuse `409 proposal_stale` and install nothing. A reviewer approves exactly the bytes they read.

On a successful install the host sets `state: applied` and populates a new optional, closed `activation.installedArtifact`:

```jsonc
"installedArtifact": {
  "kind": "prompt-template",
  "operationId": "getPromptTemplate",   // a v2 operation in spec/v2/path-manifest.json
  "id": "vendor.acme.summarize",        // the path parameter that operation takes
  "version": "1.2.0"                    // optional; when the read surface is versioned
}
```

- `operationId` MUST name a GET operation in `spec/v2/path-manifest.json` that serves the installed artifact to a caller in the applying tenant holding that operation's scope. The read is evaluated in that tenant's scope: for any other tenant, the installed artifact MUST NOT be served, listed or resolvable, and its read answers as an id that does not exist.
- `id` MUST be the artifact's own identifier (for `prompt-template`, `artifact.templateId`). A host MUST NOT mint one.
- **Byte-match.** The body that operation returns, with the kind's host-owned fields removed (§D), MUST be RFC 8785 (JCS) equal to the `artifact` last persisted on the proposal before apply. This is RFC 0096 §E.3 stated so that an outside party can check it.
- `installedArtifactRef` (string) stays, optional and unchanged. A host MAY keep emitting it, and a client MUST NOT treat it as resolvable.

### §D — Read-back per kind

| Kind | Read operation | Host-owned fields excluded from the comparison | Phase |
| --- | --- | --- | --- |
| `prompt-template` | `getPromptTemplate` (`GET /prompts/{templateId}`) | `meta` (removed from both sides) | 1 |
| `workflow-chain-pack` | to be audited: `GET /workflows/{workflowId}` serves one installed workflow, not the pack | — | 2 |
| `agent-pack` | to be audited: `GET /agents/{agentId}` serves an inventory entry, not the manifest bytes | — | 2 |
| `automation` | none at v2 | — | 3 |

**Only `meta` is host-owned for `prompt-template`.** `prompt-template.schema.json` is closed, so a field the server sets MUST live under `meta`. A server-set top-level field is a schema violation, not an exclusion.

**Installing a `prompt-template`** behaves as the prompts write would in the applying tenant:
- an absent `templateId` installs as `createPromptTemplate`;
- a user-sourced template with a lower stored version installs as `updatePromptTemplate`;
- an equal or higher stored version is refused `409 proposal_install_conflict`, `details.reason: "version-not-greater"`;
- a pack-sourced or host template is refused `409 proposal_install_conflict`, `details.reason: "read-only"`.

`version_conflict` is not reused: it means a pack version published with different content, and widening it would change a code's meaning.

On each refusal the host installs nothing and leaves `state` unchanged.

A host MUST advertise in `agents.proposals.readback` (an optional array of kinds, unique items, a subset of `artifactKinds`) only kinds whose `installedArtifact` resolves under this section. For a kind it proposes but cannot read back, the two invariants still bind, but no outside party can check them; the facet description says so per kind. This is disclosure, not a demotion.

**Inertness for `prompt-template`.** While a proposal with `kind: prompt-template` is in any state other than `applied`, `getPromptTemplate` and `listPromptTemplates` MUST NOT serve a template carrying its `(templateId, version)`, and `POST /prompts:render` naming it MUST fail as it does for an unknown template. This is the observable form of RFC 0096 §E.1 for the one kind whose resolution surface v2 exposes.

### §E — Events and replay

`proposal.created` and `proposal.activated` are unchanged. A host emits `proposal.created` for a submitted draft too, with `sourceRunIds: []`.

Apply, reject and archive are side effects outside any run. `POST /runs/{runId}:fork` never re-fires them. A replay fork of a run whose trace produced a proposal MUST NOT synthesize a new proposal: synthesis is a recorded fact of the source run (`replay.md`, recorded facts), so the fork reuses the recorded `proposal.created` and does not repeat it. This adds no new nondeterminism to the event log.

### §F — Where the rules live

The core budget is at its cap (37,998 / 38,000 words), so the rules land in the files the `agents` family already lists in `normativeText`: the facet description (`clientDrafts`, `readback`, inertness for `prompt-template`), `proposal.schema.json` (`installedArtifact`, the byte-match rule), and the operation descriptions. `execution.md` gains one word-neutral pointer naming the operations, for the normative-home check. This RFC states the change; after merge those files own the rules.

### Examples

**Positive.** On a host advertising `{artifactKinds:["prompt-template"], activation:"direct-rbac", clientDrafts:true, readback:["prompt-template"]}`:

1. `POST /proposals {kind:"prompt-template", artifact:T}` → `201`, `state: draft`.
2. `GET /prompts/{T.templateId}` → `404`.
3. `PATCH /proposals/{id} {artifact:T'}` → `200`, `state: revised`.
4. `POST /proposals/{id}:apply` → `200`, `state: applied`, `installedArtifact {kind:"prompt-template", operationId:"getPromptTemplate", id:T'.templateId}`.
5. `GET /prompts/{T'.templateId}` with `meta` removed is JCS-equal to `T'`, and not to `T`.

**Negative.**

- `POST /proposals {kind:"automation", …}` on a host whose `artifactKinds` lacks it → `400 validation_error`, `details.field: kind`.
- `:apply` without the activation scope → `403 insufficient_scope`; `state` stays `revised`; `GET /prompts/{id}` still `404`.
- Tenant B: `GET /proposals/{tenantA-id}` → `404`, the same answer as an unknown id.
- `installedArtifact` with `operationId: "createPromptTemplate"` (not a GET) fails §C.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.4):

- **New operations.** They are unversioned, and a host that does not advertise `agents.proposals` already serves none of them.
- **New facet members.** `clientDrafts` and `readback` are optional on a closed object. Omitting them keeps today's meaning.
- **`activation.installedArtifact`.** It is a new optional closed property. `installedArtifactRef` keeps its type and stays optional.
- **New scopes.** `proposals:read` and `proposals:write` are new vocabulary. Existing scopes keep their meaning.
- **Events and MUSTs.** No event shape changes, and no MUST is relaxed. The two invariants gain an observation path.

`proposal.schema.json` leaves the v1 seed set: its `x-openwop-seeded-from` marker is removed, and this RFC owns the file (`scripts/derive-v2-schemas.mjs`).

A host advertising `agents.proposals` without these operations is not newly non-conformant on the wire: the operations are new requirements of the facet, witnessed by new legs, and such a host reports `blocked` on them until it implements them. See R1.

## Conformance

**Existing coverage.**

- `proposal-reviewable-learning.test.ts` is v1 only and drives `/v1/host/sample/proposals`.
- No `v2-*` scenario reads a proposal.
- `getPromptTemplate` is exercised by the prompts scenarios.

**New scenario `v2-proposal-lifecycle.test.ts`.** It is gated on `agents.proposals` present, `clientDrafts: true` and `readback ∋ prompt-template`. Otherwise it records `inapplicable`. The shape legs are server-free. A host leg whose harness key is unset records `blocked`, the `v2-auth-challenge` precedent: the suite will not infer a credential. Each run uses a fresh `templateId`.

| Id | Case | Expect |
| --- | --- | --- |
| `0249.shape` | (server-free) `installedArtifact`, `proposal-submit`, `proposal-revise` positives and negatives | validate / refuse |
| `0249.submit-kind-refused` | submit a kind outside `artifactKinds` | `400`, `details.field: kind` |
| `0249.draft-inert` | submit a template draft; read and render it | `getPromptTemplate` `404`; `:render` fails; absent from `listPromptTemplates` |
| `0249.apply-unscoped-refused` | `:apply` with `OPENWOP_TEST_LOW_SCOPE_KEY` (holds read and write, not `proposals:apply`; `direct-rbac`) | `403 insufficient_scope`; state unchanged; template still `404` |
| `0249.apply-stale-refused` | `:apply` with an `artifactDigest` of the pre-revision artifact | `409 proposal_stale`; state unchanged; template still `404` |
| `0249.apply-installs` | `:apply` with the scope and the current `artifactDigest` | `state: applied`; `installedArtifact {kind, operationId: getPromptTemplate, id: templateId}` resolves |
| `0249.terminal-refused` | revise, then apply again, on the applied proposal | `409 proposal_state_conflict`, `details.state: applied` |
| `0249.readback-byte-match` | revise to `T'`, then apply | the read-back minus `meta` is JCS-equal to `T'` and differs from `T` |
| `0249.cross-tenant-not-found` | `OPENWOP_TEST_TENANT_B_API_KEY` reads and applies the draft, then reads the installed template | `404` on each, identical to an unknown id |
| `0249.unadvertised-not-found` | a host without `agents.proposals` | `404 not_found` on `GET /proposals` (`errors.md` §Unadvertised operations) |

The `approval-gate` path and the replay-fork rule (§E) have no leg in phase 1. See UQ 2 and G3.

**Invariants.** When the legs ship, both rows' `tests` gain `v2-proposal-lifecycle.test.ts` and their `witness` moves `seam-gated → witnessable-gated`. The seam count goes down, which the ratchet allows.

**Witnessing host.** None today: openwop-app does not advertise `agents.proposals`, and MyndHyve advertises it at v1 only. `Accepted` needs a certified major-2 bundle with the `0249.*` rows `executed-pass` (G1).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A unadvertised → `404 not_found` | the response to `GET /proposals` | the suite, unaided | witnessable-unaided |
| §A tenant scoping, no oracle | a second tenant's `404` vs an unknown id's `404` | the suite, with two tenants' credentials | witnessable-gated |
| §B kind validated | `400` + `details.field` | the suite | witnessable-gated |
| §B `sourceRunIds: []`, no invented provenance | `getProposal` after submit | the suite | witnessable-gated |
| §C unscoped apply refused, nothing installed | `403` + template still `404` | the suite, with a narrowed token | witnessable-gated |
| §C `installedArtifact` resolves to a GET | the named operation answers `200` | the suite | witnessable-gated |
| §C digest binding, mismatch refused | `409 proposal_stale` + template still `404` | the suite (it computes both digests) | witnessable-gated |
| §C read-back tenant-scoped | tenant B's `getPromptTemplate` `404` vs an unknown id | the suite, with two tenants' credentials | witnessable-gated |
| §A terminal states refused | `409 proposal_state_conflict` | the suite | witnessable-gated |
| §C byte-match (JCS) | read-back minus host-owned fields vs the revised artifact | the suite (it wrote both) | witnessable-gated |
| §D inertness, `prompt-template` | `404` on get, failed render, absent from list | the suite | witnessable-gated |
| §D inertness, other kinds | no v2 surface resolves them | nobody outside the host | unwitnessable until phase 2/3 (disclosed in the facet) |
| §C `approval-gate` install only on grant | `202` + token, install after resolve | the suite, as approver | witnessable-gated (no phase-1 leg) |
| §E replay fork re-synthesizes nothing | proposal count before/after `:fork` | only a host whose synthesis is traceable to a run | seam-gated (no portable trigger; G3) |

## Alternatives considered

1. **Park RFC 0096 on a host tripwire, mint nothing.** Rejected: RFCS/README rule 3 forbids parking with repository work open, and the two protocol-tier invariants would stay seam-gated with no seam at v2, in breach of `conformance.md` §Witness class.
2. **Demote the inertness and byte-match MUSTs to SHOULD.** Rejected: a relaxed MUST within v2 (`COMPATIBILITY.md` §2.2), and the wrong direction for the guarantee that an agent cannot silently change its own production behavior.
3. **A v2 seam (`/conformance/seams/proposals`).** Rejected: it would raise the seam count, which the ratchet forbids, and a seam witnesses the host's test harness, not its wire.
4. **Keep `installedArtifactRef` and make it a URI.** Rejected: an opaque string is exactly what let a hash pass as an install. Naming a manifest operation makes the read-back mechanical and checkable by `check-path-parity`.
5. **Amend RFC 0096 in place.** Rejected: this adds operations, scopes and a capability member, and two hosts relied on 0096's shape. An in-place amendment is reserved for corrections (RFCS/README §"When a correction needs a new number").

## Unresolved questions

All five were resolved on 2026-10-24 by `/architect`, using openwop-app's measured constraints:

1. **Submit scope:** no separate scope. `proposals:write` covers submit, revise, reject and archive. Activation gets `proposals:apply` (§A).
2. **`approval-gate`:** apply opens a host-owned gate run that suspends on an `approval` interrupt, so no interrupt exists outside a run (§C).
3. **`readback`:** a separate array, a subset of `artifactKinds`. Resolvability is claimed, never implied (§D).
4. **Error codes:** `409 proposal_state_conflict` with `details {state, action}` for a terminal state, and `409 proposal_stale` for a lost update or a digest mismatch. An install the target store refuses is `409 proposal_install_conflict` with `details.reason`. All three are registered in `spec/v2/errors.json` (§A, §C, §D).
5. **Host-owned fields:** `meta` only, because the template schema is closed. A host does not normalize `version`. Install follows the prompts write rules, and the read-back is tenant-scoped (§C, §D).

## Implementation notes (non-normative)

**Order.**

1. The source `api/openapi.yaml` and the derive script, then `proposal.schema.json` (remove the seed marker), the two new request schemas and the facet members.
2. The regen chain.
3. The scenario and its judge library, with self-tests that fail each wrong host answer.
4. The invariants rows.
5. A suite release.

**Hosts.** A host implements phase 1 by installing the applied artifact into its existing `/prompts` store. openwop-app's prompts store already serves `getPromptTemplate`. openwop-app implements it (ADR 0970).

**Before the suite release.** Warn MyndHyve: its v1 advert of `agents.proposals`, carried into v2 discovery, makes the new legs run, and they report `blocked` until it implements the operations.

**SDK.** openwop-sdks needs the seven operations and the closed `installedArtifact` type.

## Acceptance criteria

- [x] The seven operations in `api/openapi.yaml` and the derived `api/v2/openapi.yaml`, with `spec/v2/path-manifest.json` parity.
- [x] `agents.proposals.clientDrafts` and `readback`, and `activation.installedArtifact`, with the rules in their descriptions; `proposal-submit` and `proposal-revise` schemas.
- [x] The `security-defaults.md` obligation row (the `execution.md` pointer was dropped: `proposals` is already named there, and the kernel is at its 38,000-word cap); `proposals:read` / `proposals:write` / `proposals:apply` and the three error codes registered.
- [x] `v2-proposal-lifecycle.test.ts` with the legs above, its judges and their self-tests; both invariants point at it and are `witnessable-gated`.
- [x] CHANGELOG entry; openwop-sdks issue filed (openwop/openwop-sdks#59).
- [x] A host advertises `agents.proposals` with `clientDrafts` and `readback ∋ prompt-template`, and a certified major-2 bundle records the `0249.*` host legs `executed-pass`.

## References

- [RFC 0096](./0096-reviewable-learning-skill-proposal-lifecycle.md): the lifecycle and the two invariants this RFC makes observable.
- [RFC 0027](./0027-prompt-templates.md) / [RFC 0028](./0028-prompt-library-endpoints.md): the prompt-template store the phase-1 read-back uses.
- [RFC 0049](./0049-rbac-scopes-and-authorization-decisions.md) / [RFC 0051](./0051-approval-deployment-gate-primitive.md): activation by scope or approval gate.
- [RFC 0048](./0048-tenant-workspace-principal-identity-model.md): the owner triple and tenant scoping.
- RFC 8785: JSON Canonicalization Scheme, as already used by `vectors/jcs-v1.json`.
- `spec/v2/core/conformance.md` §Witness class; `spec/v2/core/interrupt.md` §Approval; `spec/v2/core/identity.md` (`insufficient_scope`); `spec/v2/core/replay.md` (recorded facts).
- openwop-app ADR 0938 / openwop-app #5019: the re-grade that found no install.

## Status history

- 2026-10-24 — Draft (openwop#2030).
- 2026-10-24 — Active (comment window waived; STEWARD OVERRIDE of RFC 0147 §A.6, see Updated).
- 2026-10-24 — Accepted (tier-1, openwop-app cut 209c `34bfefddc`; §B review deferred by steward exemption).
