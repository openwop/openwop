# RFC 0249: v2 proposal operations and a verifiable install read-back

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0249                                                            |
| **Title**         | Normative v2 operations for RFC 0096 proposals, a client-submitted draft, and an install read-back the suite can byte-compare |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-24                                                      |
| **Updated**       | 2026-10-24 — Draft, from the `/architect` ruling on RFC 0096's v2 gap. The comment window is open (not waived). |
| **Affects**       | `api/openapi.yaml` → `api/v2/openapi.yaml` (seven operations, tag `proposals`) · `spec/v2/path-manifest.json` (generated) · `spec/v2/facets/agents.schema.json` `proposals` (optional `clientDrafts`, `readback`) · `schemas/v2/proposal.schema.json` (optional `activation.installedArtifact`; the file leaves the v1 seed set) · new `schemas/v2/proposal-submit.schema.json`, `proposal-revise.schema.json` · `spec/v2/core/execution.md` (a one-line pointer, word-neutral) · `spec/v2/core/security-defaults.md` (one obligation row) · `SECURITY/invariants.yaml` (`proposal-inert-until-applied`, `proposal-no-resynthesis`: v2 tests, witness class) · conformance: `v2-proposal-lifecycle.test.ts` · CHANGELOG · openwop-sdks (follow-up) |
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

All seven are unversioned paths under the `proposals` tag, gated on the `agents.proposals` facet. A host that does not advertise it MUST answer every one `404 capability_not_provided`, the `runs.md` pattern for an unadvertised mode.

| Operation | Method + path | Scope | Notes |
| --- | --- | --- | --- |
| `listProposals` | `GET /proposals?state=&kind=` | `proposals:read` | Paginated `{items, nextCursor?}`, scoped to the caller's tenant and workspace. |
| `getProposal` | `GET /proposals/{proposalId}` | `proposals:read` | One `Proposal`, including the inert `artifact`. |
| `submitProposal` | `POST /proposals` | `proposals:write` | Only when the facet advertises `clientDrafts: true`; otherwise `404 capability_not_provided`. Body `proposal-submit` → `201` with the `Proposal` in `draft`. |
| `reviseProposal` | `PATCH /proposals/{proposalId}` | `proposals:write` | Body `proposal-revise`; sets `state: revised`. MUST NOT activate. Refused with `409` in a terminal state (code: UQ 4). |
| `applyProposal` | `POST /proposals/{proposalId}:apply` | the facet's `activation` | §C. |
| `rejectProposal` | `POST /proposals/{proposalId}:reject` | `proposals:write` | `state: rejected`; optional `{reason}` (redaction-safe). |
| `archiveProposal` | `DELETE /proposals/{proposalId}` | `proposals:write` | Soft: `state: archived`. |

A proposal is owned by the RFC 0048 triple in `owner`. A host MUST NOT list, return, revise, apply, reject or archive a proposal for a caller outside that tenant, and MUST answer such a request exactly as it answers an id that does not exist (`404`), so the operation is not an existence oracle.

### §B — Client-submitted drafts

`agents.proposals` gains one optional member, `clientDrafts: boolean` (default `false`). When `true`, `submitProposal` accepts `{kind, artifact, title?, rationale?}`. The host:

- MUST validate `kind` against the advertised `artifactKinds` (`400 validation_error`, `details.field: kind`);
- MAY validate `artifact` against the kind's own schema at submit, and MUST at apply (RFC 0096 G5: `422` on mismatch);
- MUST set `provenance.sourceRunIds: []` and MUST NOT invent run provenance;
- MUST treat the result exactly as a synthesized draft. Every RFC 0096 rule applies, and inertness first among them.

### §C — Apply and the install read-back

`applyProposal` routes through the facet's `activation`, as RFC 0096 §E.2 already requires:

- `direct-rbac`: the caller MUST hold the scope the host advertises for activation. Without it the host answers `403` with `error="insufficient_scope"` (`identity.md`), installs nothing, and leaves `state` unchanged.
- `approval-gate`: the host answers `202` with an interrupt token resolvable at `POST /interrupts/{token}` (`interrupt.md` §Approval) and installs only when the gate resolves `granted` or audited `overridden`. See UQ 2.

On a successful install the host sets `state: applied` and populates a new optional, closed `activation.installedArtifact`:

```jsonc
"installedArtifact": {
  "kind": "prompt-template",
  "operationId": "getPromptTemplate",   // a v2 operation in spec/v2/path-manifest.json
  "id": "vendor.acme.summarize",        // the path parameter that operation takes
  "version": "1.2.0"                    // optional; when the read surface is versioned
}
```

- `operationId` MUST name a GET operation in `spec/v2/path-manifest.json` that serves the installed artifact to a caller holding that operation's scope.
- **Byte-match.** The body that operation returns, with the kind's host-owned fields removed (§D), MUST be RFC 8785 (JCS) equal to the `artifact` last persisted on the proposal before apply. This is RFC 0096 §E.3 stated so that an outside party can check it.
- `installedArtifactRef` (string) stays, optional and unchanged. A host MAY keep emitting it, and a client MUST NOT treat it as resolvable.

### §D — Read-back per kind

| Kind | Read operation | Host-owned fields excluded from the comparison | Phase |
| --- | --- | --- | --- |
| `prompt-template` | `getPromptTemplate` (`GET /prompts/{templateId}`) | `meta` | 1 |
| `workflow-chain-pack` | to be audited: `GET /workflows/{workflowId}` serves one installed workflow, not the pack | — | 2 |
| `agent-pack` | to be audited: `GET /agents/{agentId}` serves an inventory entry, not the manifest bytes | — | 2 |
| `automation` | none at v2 | — | 3 |

A host MUST advertise in `agents.proposals.readback` (an optional array of kinds, unique items) only kinds whose `installedArtifact` resolves under this section. For a kind it proposes but cannot read back, the two invariants still bind, but no outside party can check them; the facet description says so per kind. This is disclosure, not a demotion.

**Inertness for `prompt-template`.** While a proposal with `kind: prompt-template` is in any state other than `applied`, the template it carries MUST NOT be served by `getPromptTemplate` or `listPromptTemplates`, and `POST /prompts:render` naming it MUST fail as it does for an unknown template. This is the observable form of RFC 0096 §E.1 for the one kind whose resolution surface v2 exposes.

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

**New scenario `v2-proposal-lifecycle.test.ts`.** It is gated on `agents.proposals` present, `clientDrafts: true` and `readback ∋ prompt-template`. Otherwise it records `inapplicable`. It is server-free on the shape legs.

| Id | Case | Expect |
| --- | --- | --- |
| `0249.shape` | (server-free) `installedArtifact`, `proposal-submit`, `proposal-revise` positives and negatives | validate / refuse |
| `0249.submit-kind-refused` | submit a kind outside `artifactKinds` | `400`, `details.field: kind` |
| `0249.draft-inert` | submit a template draft; read and render it | `getPromptTemplate` `404`; `:render` fails; absent from `listPromptTemplates` |
| `0249.apply-unscoped-refused` | `:apply` with a token lacking the activation scope (`direct-rbac`) | `403 insufficient_scope`; state unchanged; template still `404` |
| `0249.apply-installs` | `:apply` with the scope | `state: applied`; `installedArtifact` resolves through `getPromptTemplate` |
| `0249.readback-byte-match` | revise to `T'`, then apply | the read-back minus `meta` is JCS-equal to `T'` and differs from `T` |
| `0249.cross-tenant-not-found` | a second tenant's credentials read and apply the draft | `404` on both, identical to an unknown id |
| `0249.unadvertised-refused` | a host without `agents.proposals` | `404 capability_not_provided` on `GET /proposals` |

The `approval-gate` path and the replay-fork rule (§E) have no leg in phase 1. See UQ 2 and G3.

**Invariants.** When the legs ship, both rows' `tests` gain `v2-proposal-lifecycle.test.ts` and their `witness` moves `seam-gated → witnessable-gated`. The seam count goes down, which the ratchet allows.

**Witnessing host.** None today: openwop-app does not advertise `agents.proposals`, and MyndHyve advertises it at v1 only. `Accepted` needs a certified major-2 bundle with the `0249.*` rows `executed-pass` (G1).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A unadvertised → `404 capability_not_provided` | the response to `GET /proposals` | the suite, unaided | witnessable-unaided |
| §A tenant scoping, no oracle | a second tenant's `404` vs an unknown id's `404` | the suite, with two tenants' credentials | witnessable-gated |
| §B kind validated | `400` + `details.field` | the suite | witnessable-gated |
| §B `sourceRunIds: []`, no invented provenance | `getProposal` after submit | the suite | witnessable-gated |
| §C unscoped apply refused, nothing installed | `403` + template still `404` | the suite, with a narrowed token | witnessable-gated |
| §C `installedArtifact` resolves to a GET | the named operation answers `200` | the suite | witnessable-gated |
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

1. `clientDrafts` lets any `proposals:write` holder create an inert draft. Should submit need a separate scope (`proposals:submit`) so a host can let reviewers revise without letting them author?
2. `approval-gate` apply outside a run: is `202` plus a token at `POST /interrupts/{token}` the right shape, or should apply open a run that suspends on an RFC 0051 approval interrupt, which the suite can already resolve?
3. Should `readback` be a separate array, or should `installedArtifact` resolvability be implied by a kind's presence in `artifactKinds` once phase 2 lands?
4. Which error code answers `PATCH` or `:apply` on a `rejected` or `archived` proposal: `run_state_conflict`'s sibling, a new `proposal_state_conflict`, or `409` with a reused code?
5. For `prompt-template`, is `meta` the complete host-owned set, or does a host also normalize `version` on install?

## Implementation notes (non-normative)

**Order.**

1. The source `api/openapi.yaml` and the derive script, then `proposal.schema.json` (remove the seed marker), the two new request schemas and the facet members.
2. The regen chain.
3. The scenario and its judge library, with self-tests that fail each wrong host answer.
4. The invariants rows.
5. A suite release.

**Hosts.** A host implements phase 1 by installing the applied artifact into its existing `/prompts` store. openwop-app's prompts store already serves `getPromptTemplate`. Whether it implements this is the user's decision (relayed 2026-10-24).

**Before the suite release.** Warn MyndHyve: its v1 advert of `agents.proposals`, carried into v2 discovery, makes the new legs run, and they report `blocked` until it implements the operations.

**SDK.** openwop-sdks needs the seven operations and the closed `installedArtifact` type.

## Acceptance criteria

- [ ] The seven operations in `api/openapi.yaml` and the derived `api/v2/openapi.yaml`, with `spec/v2/path-manifest.json` parity.
- [ ] `agents.proposals.clientDrafts` and `readback`, and `activation.installedArtifact`, with the rules in their descriptions; `proposal-submit` and `proposal-revise` schemas.
- [ ] The `execution.md` pointer and the `security-defaults.md` obligation row; `proposals:read` / `proposals:write` registered.
- [ ] `v2-proposal-lifecycle.test.ts` with the eight legs, its judges and their self-tests; both invariants point at it and are `witnessable-gated`.
- [ ] CHANGELOG entry; openwop-sdks issue filed.
- [ ] A host advertises `agents.proposals` with `clientDrafts` and `readback ∋ prompt-template`, and a certified major-2 bundle records the `0249.*` host legs `executed-pass`.

## References

- [RFC 0096](./0096-reviewable-learning-skill-proposal-lifecycle.md): the lifecycle and the two invariants this RFC makes observable.
- [RFC 0027](./0027-prompt-templates.md) / [RFC 0028](./0028-prompt-library-endpoints.md): the prompt-template store the phase-1 read-back uses.
- [RFC 0049](./0049-rbac-scopes-and-authorization-decisions.md) / [RFC 0051](./0051-approval-deployment-gate-primitive.md): activation by scope or approval gate.
- [RFC 0048](./0048-tenant-workspace-principal-identity-model.md): the owner triple and tenant scoping.
- RFC 8785: JSON Canonicalization Scheme, as already used by `vectors/jcs-v1.json`.
- `spec/v2/core/conformance.md` §Witness class; `spec/v2/core/interrupt.md` §Approval; `spec/v2/core/identity.md` (`insufficient_scope`); `spec/v2/core/replay.md` (recorded facts).
- openwop-app ADR 0938 / openwop-app #5019: the re-grade that found no install.
