# RFC 0253: Read back an installed workflow-chain or agent pack

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0253                                                            |
| **Title**         | One v2 read that serves an installed pack's `pack.json`, so an applied `workflow-chain-pack` or `agent-pack` proposal can be byte-compared |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-29                                                      |
| **Updated**       | 2026-10-29 — Draft, closing RFC 0249 gap G2 after the 2026-10-29 audit (#2056) found no v2 operation that serves an installed pack. |
| **Affects**       | `api/openapi.yaml` → `api/v2/openapi.yaml` (one operation, `getInstalledPack`) · `spec/v2/path-manifest.json` (generated) · `spec/v2/facets/agents.schema.json` `proposals.readback` (description only; the enum already admits both kinds) · `schemas/v2/proposal.schema.json` `activation.installedArtifact` (description only) · `SECURITY/invariants.yaml` (`proposal-inert-until-applied`, `proposal-no-resynthesis`: a second test file) · conformance: new `v2-proposal-pack-readback.test.ts` · CHANGELOG · openwop-sdks (follow-up) |
| **Compatibility** | `additive`                                                      |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0249 made an applied proposal checkable: `activation.installedArtifact` names a v2 GET, and that read, minus the kind's host-owned fields, must be RFC 8785 (JCS) equal to the reviewed `artifact`. Phase 1 covered `prompt-template` only, because v2 has no operation that serves an installed pack. This RFC mints one: `getInstalledPack`, `GET /installed-packs/{packName}`, which serves the `pack.json` installed in the caller's tenant. It also states, for the two pack kinds, what a proposed artifact may contain so that a manifest-only install can be byte-compared at all. With it a host can advertise `readback` for `workflow-chain-pack` and `agent-pack`, and the suite can witness both RFC 0096 invariants for those kinds.

## Motivation

`agents.proposals.readback` says `workflow-chain-pack`, `agent-pack` and `automation` have no read-back at v2. For a host that proposes those kinds, the two protocol-tier invariants (`proposal-inert-until-applied`, critical; `proposal-no-resynthesis`, high) bind but no outside party can check them. RFC 0249 recorded this as gap G2 and transferred it to `TODO.md` for an audit.

The audit (2026-10-29, #2056) found:

- **No pack read at v2.** `spec/v2/path-manifest.json` has no operation that serves a pack. The only pack endpoints in `api/openapi.yaml` are the v1 test registry `/v1/packs-test/...`, a seam that is not in the v2 manifest.
- **`getWorkflow` is not a pack read.** It serves one registered workflow. A chain pack is an author-time abstraction: its chains are expanded into a parent definition, and a runtime sub-chain child is registered under a host-derived id (`workflow-chain-packs.md` §Co-registered children). Nothing a workflow read returns is the pack's bytes.
- **`getAgent` is not a pack read.** It returns an `AgentInventoryEntry` (`schemas/v2/agent-inventory-response.schema.json`), a host-shaped view of one agent, not the manifest.
- **An agent pack is a node pack.** There is no separate agent-pack schema at v1 or v2. An agent pack is a `pack.json` that validates against `schemas/v2/node-pack-manifest.schema.json` with `kind: "node"` (or absent) and a non-empty `agents[]`, each entry an `agent-manifest.schema.json` (RFC 0003, Alternatives 1). A pure-agent pack sets `runtime.language: "remote"`.
- **An agent manifest can point into a tarball.** `systemPromptRef`, `evalSuiteRef`, `handoff.taskSchemaRef` and `handoff.returnSchemaRef` are tarball-relative paths. A proposal carries only `artifact`, a JSON object, so it has nowhere to carry those files, and a read of `pack.json` alone cannot show them.

`spec/v2/core/conformance.md` §Witness class requires a MUST whose only witness is missing to gain an observation path or be disclosed. RFC 0249 chose disclosure for these kinds in phase 1. This RFC mints the path for phase 2.

No host proposes either kind at v2 today. openwop-app advertises `artifactKinds: ["prompt-template"]`; the retired MyndHyve runtime advertised all four kinds with no operations. The motivation is to finish RFC 0249's design before a host proposes a pack kind, not to fix a host that does.

## Proposal

### §A — The operation

| Operation | Method + path | Scope | Response |
| --- | --- | --- | --- |
| `getInstalledPack` | `GET /installed-packs/{packName}` | `manifest:read` | `200`: the installed `pack.json`, validating against `workflow-chain-pack-manifest` when `kind: "workflow-chain"`, else `node-pack-manifest`. `404 not_found` otherwise. |

- `packName` is the manifest `name`, matching the existing pattern `^(core|vendor|community|private)\.…`. It is URL-safe as written.
- The path is unversioned and outside the registry tree. `/packs/...` is avoided so it cannot be read as a registry path (`packs.md` §The registry tree).
- `manifest:read` is the scope `getWorkflow` already uses for reading definitions. No new scope is minted.
- **Advertisement.** The operation is advertised when `agents.proposals.readback` contains `workflow-chain-pack` or `agent-pack`. A host that does not advertise it answers `404 not_found`, as `errors.md` §Unadvertised operations requires.
- **Tenant scoping.** The read is evaluated in the caller's tenant. A pack installed in another tenant MUST be answered exactly as a name that is not installed (`404`), so the operation is not an existence oracle. This is RFC 0249 §C's read-back rule, applied to a second operation.
- **One version per tenant.** The read serves the version currently installed in the caller's tenant. `installedArtifact.version` carries the version the apply installed, so a client can tell when a later install has replaced it (UQ 4).
- **What it serves.** A host MUST serve, through this read, every pack installed in the tenant by `applyProposal`. A host MAY also serve packs it installed from a registry; this RFC places no obligation on them (UQ 3).

The response is the bare manifest, not an envelope. Install metadata (source, time, integrity) has no field in the body; both manifest schemas are closed apart from the vendor hatch, and a host MUST NOT add hatch properties the installed artifact did not carry.

### §B — `installedArtifact` for the two kinds

On a successful apply of a `workflow-chain-pack` or `agent-pack` proposal, on a host whose `readback` contains that kind:

```jsonc
"installedArtifact": {
  "kind": "agent-pack",                  // or "workflow-chain-pack"
  "operationId": "getInstalledPack",
  "id": "private.acme.triage-agents",    // artifact.name; a host MUST NOT mint one
  "version": "1.0.0"                     // artifact.version
}
```

`id` is the artifact's own `name`, and `version` is REQUIRED for these two kinds. Both follow RFC 0249 §C, which already allows `version` "when the read surface is versioned".

### §C — Byte-match and the host-owned fields

The host-owned field set is **empty** for both kinds. The body `getInstalledPack` returns MUST be RFC 8785 (JCS) equal to the `artifact` last persisted before apply, with nothing removed from either side.

The `meta` precedent does not carry over. `prompt-template` has a `meta` member where server-set values must live. Neither pack manifest has one: each is closed apart from the pack-authored vendor hatch (`^(openwop-|x-|vendor\.)`), and `packs.md` §The manifest schema family makes hatch values pack-authored and untrusted. A host-set value therefore has no lawful place in the body, and excluding nothing keeps the comparison exact.

The one field a host might want to own is `signing`. A proposal has no tarball and no detached signature, so a `signing` block on a proposed pack would claim registry provenance that cannot be verified. A host advertising `readback` for the kind MUST refuse to apply an artifact carrying `signing` with `422` (RFC 0249 §B: an artifact that does not validate for its kind), and MUST NOT add one at install (UQ 2).

### §D — What a proposed pack may contain

A manifest-only install can be byte-compared only if the manifest is the whole artifact. On a host whose `readback` contains the kind, at apply:

**`agent-pack`.** The artifact MUST validate against `node-pack-manifest.schema.json` with a non-empty `agents[]`, and:

- MUST NOT carry `nodes` (a non-empty `nodes[]` is executable code that has no tarball to come from);
- MUST set `runtime.language: "remote"`, as a pure-agent pack already must, and the host MUST NOT dereference `runtime.entry` for it;
- every agent MUST carry an inline `systemPrompt`, and MUST NOT carry `systemPromptRef`, `evalSuiteRef`, `handoff.taskSchemaRef` or `handoff.returnSchemaRef`.

**`workflow-chain-pack`.** The artifact MUST validate against `workflow-chain-pack-manifest.schema.json`. A chain manifest has no tarball-relative field, so no further restriction applies. Every node and sub-chain reference stays exact-pinned (`workflow-chain-packs.md` §Exact pins).

A violation is refused `422` and installs nothing; the proposal's `state` is unchanged.

**The referenced-files decision.** This RFC discloses rather than covers the tarball files. A proposed agent that needs a typed handoff or a portable eval suite cannot be proposed through a read-back-advertised kind in phase 2. `handoff: {}` remains valid, so a `role: "skill"` agent (which requires `handoff`) can still be proposed, with an opaque payload contract. Carrying files in a proposal is UQ 5.

### §E — Install semantics

Installing behaves as the host's pack install would in the applying tenant, with the conflicts RFC 0249 §D defined for templates:

- no pack of that `name` in the tenant: install;
- a pack of that `name` that an earlier proposal installed, at a lower version: replace it;
- an equal or higher installed version: `409 proposal_install_conflict`, `details.reason: "version-not-greater"`;
- a pack of that `name` the host installed from a registry or ships itself: `409 proposal_install_conflict`, `details.reason: "read-only"`;
- for `agent-pack`, an `agentId` already resolvable in the tenant from another pack: `409 proposal_install_conflict`, `details.reason: "read-only"`.

No new error code or `reason` value is minted. On each refusal the host installs nothing and leaves `state` unchanged.

### §F — Inertness, observably

While a proposal of either kind is in any state other than `applied`, on a host whose `readback` contains the kind:

- `getInstalledPack` for its `name` MUST answer `404` (when no other install of that name exists in the tenant);
- for `agent-pack`, `getAgent` for each proposed `agentId` MUST answer `404`, and `listAgents` MUST NOT list it.

After apply, the agents are resolvable only in the applying tenant: `getAgent` from another tenant answers as an unknown agent, which `getAgent`'s `installScope` rule already requires.

### §G — Where the rules live

The core budget is at its cap (38,000 / 38,000 words, `check-core-budget.mjs`), so, as in RFC 0249 §F, no core doc gains words. After merge at `Active`:

| Rule | Owner |
| --- | --- |
| §A operation, scope, advertisement, tenant scoping, what it serves | the `getInstalledPack` description in `api/openapi.yaml` (derived into `api/v2/openapi.yaml`) |
| §B `id` and `version` for pack kinds; §C empty host-owned set | `schemas/v2/proposal.schema.json` `activation.installedArtifact` description |
| §C `signing` refused; §D content rules; §E install conflicts; §F inertness | `spec/v2/facets/agents.schema.json` `proposals.readback` description (the `agents` family's `normativeText`) |

`packs.md` and `workflow-chain-packs.md` are unchanged: their install, signing and pin rules bind a registry install as before, and this RFC adds a second, proposal-only install path that their rules do not describe. Whether `packs.md` should gain a pointer when budget allows is G3.

### Examples

**Positive.** On a host advertising `{artifactKinds:["agent-pack"], activation:"direct-rbac", clientDrafts:true, readback:["agent-pack"]}`, with `P` a pure-agent pack `private.conf.a1b2` at `1.0.0`, one agent `conf-a1b2` with an inline `systemPrompt`:

1. `POST /proposals {kind:"agent-pack", artifact:P}` → `201`, `state: draft`.
2. `GET /installed-packs/private.conf.a1b2` → `404`; `GET /agents/conf-a1b2` → `404`.
3. `PATCH /proposals/{id} {artifact:P'}` (a different `systemPrompt`) → `200`, `state: revised`.
4. `POST /proposals/{id}:apply` → `200`, `installedArtifact {kind:"agent-pack", operationId:"getInstalledPack", id:"private.conf.a1b2", version:"1.0.0"}`.
5. `GET /installed-packs/private.conf.a1b2` is JCS-equal to `P'`, and not to `P`.

**Negative.**

- An agent-pack artifact whose agent carries `systemPromptRef: "prompts/a.md"` → `:apply` `422`; `GET /installed-packs/…` still `404`.
- An agent-pack artifact with a non-empty `nodes[]` → `:apply` `422`.
- A chain-pack artifact carrying `signing {keyId, scheme}` → `:apply` `422`.
- Tenant B: `GET /installed-packs/private.conf.a1b2` → `404`, the same answer as an unknown name.
- `installedArtifact {kind:"agent-pack", operationId:"getAgent", id:"conf-a1b2"}` fails §B: `getAgent` does not serve the pack.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1, §2.4):

- **New operation.** `getInstalledPack` is a new unversioned endpoint. A host that does not advertise `readback` for a pack kind serves `404`, which every host already answers for an unknown path.
- **No schema shape changes.** The `readback` items enum already lists `agent-pack` and `workflow-chain-pack`, so no enum widens. `installedArtifact` already has an optional `version`. Only descriptions change.
- **New MUSTs bind only a new advertisement.** §C–§F bind a host whose `readback` contains a pack kind. No host advertises that today, and no committed bundle does. A host that proposes pack kinds without `readback` keeps today's obligations.
- **No error-code change.** `proposal_install_conflict` and its two `reason` values are reused with their registered meaning (an install the target store refused). `422` is RFC 0249 §B's existing answer.
- **Response schemas.** The response references the two existing manifest schemas. If the OpenAPI uses a cross-file `$ref` into a schema that did not have one, the suite minor bumps and the CHANGELOG names the peer (§2.1 §Cross-file `$ref`).

No migration is needed.

## Conformance

**Existing coverage.**

- `v2-proposal-lifecycle.test.ts` (RFC 0249) drives the `prompt-template` flow. Its submit-kind and unadvertised legs are kind-neutral and are not repeated.
- `workflow-chain-pack-manifest-validation.test.ts` validates chain manifests server-free.
- `agentPackInstall.test.ts` and `agentPackExport.test.ts` are major 1 only and fixture-gated (`conformance-agent-pack-export`). The export leg projects workspace agents back into `AgentManifest`s; it is a v1 test fixture, not a v2 operation, and does not serve the installed `pack.json`.
- No v2 scenario reads an installed pack.

**New scenario `v2-proposal-pack-readback.test.ts`.** One set of legs per kind, each gated on `agents.proposals` with `clientDrafts: true`, `artifactKinds ∋ kind` and `readback ∋ kind`; otherwise `inapplicable`. A harness key that is unset records `blocked` (the `v2-auth-challenge` precedent). Each run uses a fresh `private.conformance.<random>` name and, for agent packs, a fresh `agentId`. The chain fixture reuses the bundled `workflow-chain-sample.pack.json` under a fresh name.

| Id | Case | Expect |
| --- | --- | --- |
| `0253.shape` | (server-free) an `installedArtifact` naming `getInstalledPack` with `version`; the two fixture artifacts validate against their manifest schemas; the negatives in §Examples fail §D | validate / refuse |
| `0253.chain-draft-inert` | submit a chain pack; read it | `getInstalledPack` `404` |
| `0253.chain-apply-installs` | revise, then apply | `installedArtifact {kind, operationId: getInstalledPack, id: name, version}` |
| `0253.chain-readback-byte-match` | read the installed pack | JCS-equal to the revision, not to the first draft |
| `0253.agent-draft-inert` | submit an agent pack; read it | `getInstalledPack` `404`; `getAgent` `404`; absent from `listAgents` |
| `0253.agent-apply-installs` | revise, then apply | as for chains; `getAgent` now `200` |
| `0253.agent-readback-byte-match` | read the installed pack | JCS-equal to the revision, not to the first draft |
| `0253.agent-file-ref-refused` | apply an agent pack whose agent carries `systemPromptRef` | `422`; `getInstalledPack` and `getAgent` still `404`; state unchanged |
| `0253.install-conflict` | submit and apply a second proposal with the same name and version | `409 proposal_install_conflict`, `details.reason: version-not-greater` |
| `0253.cross-tenant-not-found` | `OPENWOP_TEST_TENANT_B_API_KEY` reads the installed pack and agent | `404` on each, identical to an unknown name |

**Invariants.** When the legs ship, `proposal-inert-until-applied` and `proposal-no-resynthesis` add `v2-proposal-pack-readback.test.ts` to `tests`, and their notes name the pack legs. Their witness class stays `witnessable-gated`. No new invariant is minted: tenant scoping and byte-match are already the two rows' and RFC 0249's rules.

**Witnessing host.** None today. openwop-app (tier-1) is the expected first implementer: it has a marketplace pack store, and it already serves the RFC 0249 operations. This RFC does not claim it implements anything. The legacy MyndHyve runtime is retired (2026-10-29), so `Accepted` evidence will be tier-1 (G1).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A unadvertised → `404 not_found` | the response to `GET /installed-packs/{name}` | the suite, unaided | witnessable-unaided |
| §A tenant scoping, no oracle | tenant B's `404` vs an unknown name's `404` | the suite, with two tenants' credentials | witnessable-gated |
| §A a proposal-installed pack is served | `200` on the name the apply installed | the suite (it submits and applies) | witnessable-gated |
| §A no host-added hatch property | the read-back body vs the artifact | the suite | witnessable-gated (via the byte-match leg) |
| §B `id` = `name`, `version` present | `installedArtifact` on the applied proposal | the suite | witnessable-gated |
| §C byte-match, empty host-owned set | JCS equality of the read-back and the revision | the suite (it wrote both) | witnessable-gated |
| §C `signing` refused | `422`; still `404` | the suite | witnessable-gated (no host leg in the first cut; a `0253.signing-refused` leg is cheap to add at `Active`) |
| §C no `signing` added at install | the read-back has no `signing` | the suite | witnessable-gated (via the byte-match leg) |
| §D no `nodes`, inline prompt, no file refs | `422`; still `404` | the suite | witnessable-gated |
| §D `runtime.entry` not dereferenced | — | nobody outside the host: a fetch to a URL the suite does not control is not observable, and a suite-controlled URL witnesses only that host's egress policy | **unwitnessable** — disclosed; the suite uses an unroutable entry so a host that fetches gains nothing (R3) |
| §E version-not-greater refused | `409` + `reason` | the suite | witnessable-gated |
| §E read-only (registry or other pack) refused | `409` + `reason: read-only` | only when the suite knows a name or `agentId` the host installed itself | seam-gated in practice: no portable way to learn such a name; no leg (G4) |
| §F inertness, both kinds | `404` on `getInstalledPack`; `404` on `getAgent`; absent from `listAgents` | the suite | witnessable-gated |
| §F installed agents tenant-scoped | tenant B's `getAgent` `404` | the suite, with two tenants' credentials | witnessable-gated |

## Alternatives considered

1. **Do nothing; keep the disclosure.** The two invariants stay unobservable for pack kinds, and the facet keeps saying so. Rejected as the end state, because a host that starts proposing agent packs (the higher-risk kind: a proposed system prompt changes model behavior) would do so with nothing checkable. Doing nothing is acceptable only while no host proposes a pack kind, which is why this is Draft rather than urgent.
2. **Per-kind reads (`getInstalledChainPack`, `getInstalledAgentPack`).** Two operations with one rule. Rejected: both kinds are a `pack.json` keyed by `name`, and `kind` already discriminates the body. A per-kind split doubles the operation count and the advertisement logic for no difference a client can act on.
3. **Reuse `getWorkflow` for a single-chain pack.** Rejected: a chain pack is expanded at author time; `getWorkflow` serves a host-derived definition (expanded, prefixed, `{{params.*}}` substituted), never the pack. Byte-match against it would compare different documents. It also cannot cover agent packs.
4. **Serve an `AgentManifest` through `getAgent`.** Rejected: `getAgent` returns an inventory entry with host-shaped fields (`degraded[]`, roster, `a2aTenant`), and changing its body is not additive. One agent is also not the pack the reviewer approved.
5. **An envelope `{manifest, meta}` with install metadata.** It would give `source`, `installedAt` and integrity a home. Rejected for phase 2: RFC 0249 §C compares the body minus host-owned fields, so an envelope needs a new comparison rule ("the `manifest` member") rather than a host-owned field list. Kept open as UQ 3 if a general installed-pack read is wanted.
6. **A standalone facet flag (for example `packs.installedRead`).** Rejected for now: `readback` already claims resolvability per kind, and its enum already admits both kinds, so a second flag would say the same thing twice. It becomes worth having only if the read serves registry installs too (UQ 3).
7. **Cover the tarball files** (a `files` map in the artifact, or a second read for a referenced file). Rejected for phase 2: it changes what a proposal artifact is (no longer a `pack.json`), needs a file-level byte-match rule and a path-traversal rule for client-supplied paths. UQ 5.
8. **A pack-namespace rule for proposed packs.** See UQ 1; not adopted in the Draft.

## Unresolved questions

1. **Namespace.** Should a host advertising `readback` for a pack kind refuse a proposed `name` outside `private.*`? It would stop a client draft claiming `vendor.<org>.*` or `community.*` inside a tenant (RFC 0043 §A ties those to registry verification) and would make a later registry install of the same name impossible to collide with. The cost: a host that synthesizes packs must name them `private.*`.
2. **`signing`.** §C refuses a proposed `signing` block. The alternative is to make `signing` the one host-owned field (removed from both sides), letting a host sign a local install with its own key. That needs a verifier rule for a non-registry key, which `packs.md` §Signing does not have.
3. **Scope of the read.** Should `getInstalledPack` serve every pack installed in the tenant, including registry installs, under its own facet flag? That would make it a general marketplace read (useful to SDKs and UIs), and would invite an envelope for install metadata (Alternative 5).
4. **Versions.** One installed version per `(tenant, name)` is assumed. If a host keeps several (per workspace, or side by side), should the read take `?version=`, and should the byte-match read name it?
5. **Files.** Should a later phase let a proposed agent pack carry its referenced files (system prompt, handoff schemas, eval suite), and how would they be read back?
6. **Workspace.** A proposal's `owner` may name a workspace. Is a pack installed by apply visible tenant-wide (as §A states), or only in that workspace, like `getAgent`'s `installScope: 'tenant'` approval rule?

## Implementation notes (non-normative)

**Order at `Active`.**

1. `api/openapi.yaml` (or the v2 seam in `scripts/derive-v2-api.py`, since the v1 document is frozen) gains `getInstalledPack`; regenerate `api/v2/` and the path manifest.
2. The three descriptions in §G.
3. The scenario, a judge library (reuse `lib/proposal-lifecycle-witness.ts` where it is kind-neutral) with self-tests that fail each wrong host answer, two fixtures in `conformance/fixtures.md`, and the invariant rows.
4. A suite release.

**Hosts.** A host whose store keeps the installed `pack.json` verbatim serves the read from it. A host that normalizes a manifest on install (fills defaults, reorders, drops hatch properties) will fail byte-match and must keep the original bytes alongside its normalized form (R1).

**SDKs.** openwop-sdks needs `getInstalledPack` and a union response type over the two manifest types.

## Acceptance criteria

- [ ] `getInstalledPack` in `api/openapi.yaml` / the derive seam and the derived `api/v2/openapi.yaml`, with `spec/v2/path-manifest.json` parity.
- [ ] The §G descriptions in `proposal.schema.json` and `agents.schema.json`.
- [ ] `v2-proposal-pack-readback.test.ts` with the legs above, its judges and their self-tests; both invariants list it.
- [ ] CHANGELOG entry; an openwop-sdks issue filed.
- [ ] A host advertises `readback` containing at least one pack kind, and a certified major-2 bundle records that kind's `0253.*` legs `executed-pass` (tier-1).

## References

- [RFC 0249](./0249-proposal-operations-and-install-readback.md) §C, §D, gap G2: the read-back rule and the phase this RFC completes.
- [RFC 0096](./0096-reviewable-learning-skill-proposal-lifecycle.md): the lifecycle and the two invariants.
- [RFC 0003](./0003-agent-packs.md): agent packs are node packs with `agents[]`; tarball-relative refs.
- [RFC 0013](./0013-workflow-chain-packs.md) / [RFC 0133](./0133-workflow-chain-composition.md): chain packs, author-time expansion, co-registered children.
- [RFC 0043](./0043-registry-and-extension-policy.md) §A: the namespace policy behind UQ 1.
- `spec/v2/core/packs.md` (§The manifest schema family, §Signing), `spec/v2/core/workflow-chain-packs.md` (§Exact pins, §Co-registered children), `spec/v2/core/conformance.md` §Witness class, `errors.md` §Unadvertised operations.
- `schemas/v2/node-pack-manifest.schema.json`, `agent-manifest.schema.json`, `workflow-chain-pack-manifest.schema.json`, `proposal.schema.json`, `agent-inventory-response.schema.json`.
- openwop#2056: the 2026-10-29 audit of RFC 0249 G2 and G4.

## Status history

- 2026-10-29 — Draft.
