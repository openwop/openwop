# RFC 0003: Agent Packs

| Field | Value |
|---|---|
| **RFC** | 0003 |
| **Title** | Agent Packs |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-01 |
| **Updated** | 2026-05-10 |
| **Affects** | `schemas/node-pack-manifest.schema.json`, `schemas/agent-manifest.schema.json`, `spec/v1/node-packs.md`, `spec/v1/registry-operations.md`, `spec/v1/capabilities.md` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Extend the existing `pack.json` node-pack manifest with an optional `agents[]` array, each entry conforming to `agent-manifest.schema.json`. Packs MAY ship nodes only (status quo), agents only (new), or both. Agent packs reuse the existing node-pack distribution, signing, and registry machinery without protocol changes elsewhere.

## Motivation

RFC 0002 introduces `AgentRef` as the wire shape for agent identity, but does not specify how agent manifests are distributed. Today a host that wants to ship a reusable agent must:

- Embed the manifest in source, or
- Reinvent a parallel package format, or
- Couple the agent to a specific node type and ship it as a node pack.

All three break composition. The right answer is to use the existing node-pack delivery vehicle: signed, semver'd, fetched from a registry, validated by manifest schema. RFC 0003 declares that an "agent pack" is just a node pack whose manifest happens to populate `agents[]`.

This decision keeps three things stable:

- **Registry operations** (`registry-operations.md`): submission, validation, deprecation, yank, and signing-key rotation flows are unchanged.
- **Node-pack signing** (`node-packs.md` §Signing): the same Ed25519 signature covers the whole tarball, including agent manifests.
- **Host install path**: hosts validate `pack.json` against `node-pack-manifest.schema.json` and `agents[]` against `agent-manifest.schema.json`; one extra schema check.

## Proposal

### §A `agents[]` field on `NodePackManifest`

Add an optional array to the manifest:

```diff
   "properties": {
     "name": { ... },
     "version": { ... },
     "nodes": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/PackNode" } },
+    "agents": {
+      "type": "array",
+      "items": { "$ref": "https://openwop.dev/spec/v1/agent-manifest.schema.json" },
+      "description": "Optional agent manifests shipped by this pack. Each entry MUST validate against agent-manifest.schema.json. Agents are scoped to the pack's namespace tier (see §B). Packs that ship only agents MAY have an empty nodes array.",
+      "default": []
+    },
     ...
   },
   "required": ["name", "version", "engines", "nodes", "runtime"]
```

`nodes` remains required (minItems unchanged) for backward compatibility. Packs that ship only agents MUST still declare `"nodes": []`. A future minor MAY relax `minItems` on `nodes` once Phase 4 conformance proves agents-only packs work end-to-end.

### §B Namespace scoping

Agent `agentId` values inside a pack MUST share the pack's namespace tier. Validation rule:

- A pack with `"name": "vendor.acme.research-agents"` ships agents whose `agentId` matches `^vendor\.acme\.research-agents\.[a-z][a-zA-Z0-9_-]*$`.
- A pack with `"name": "core.openwop-agents"` ships agents whose `agentId` matches `^core\.openwop-agents\.[a-z][a-zA-Z0-9_-]*$`.

Registries MUST reject submissions where any agent's `agentId` violates this rule.

Cross-pack agent references are valid (a workflow MAY use `vendor.acme.research-agents.summarizer` and `vendor.beta.tools.fetch` in the same run); namespace scoping is only enforced *within* a single pack.

### §C System-prompt resolution

Per `agent-manifest.schema.json`, each agent has `systemPrompt` (inline) XOR `systemPromptRef` (tarball-relative path). Hosts MUST resolve `systemPromptRef` against the pack tarball at install time and verify:

1. The referenced file exists in the tarball.
2. The referenced file is UTF-8.
3. The referenced file's path does not escape the tarball root (no `../`, no absolute paths).

A `systemPromptRef` that fails any of these checks MUST cause manifest validation to fail at registry submission and at host install.

### §D Handoff schema resolution

The same rules apply to `handoff.taskSchemaRef` and `handoff.returnSchemaRef`. Referenced JSON Schema files MUST be valid JSON Schema 2020-12 documents; hosts MAY pre-compile them at install for runtime validation of dispatch payloads.

### §E Pack-level capability advertisement

Packs that ship agents SHOULD declare which memory backends their agents require via `peerDependencies` matching `Capabilities.agents.memoryBackends`:

```json
"peerDependencies": {
  "openwop.agents.memoryBackends": ">=longTerm"
}
```

Hosts that do not advertise the required backend MUST refuse to install the pack and SHOULD surface the missing capability in the install error envelope.

### §F Discovery shape

The pack's registry index entry SHOULD expose `agentCount` alongside `nodeCount` so catalog UIs can filter:

```json
{
  "name": "vendor.acme.research-agents",
  "version": "1.2.0",
  "nodeCount": 0,
  "agentCount": 3,
  "categories": ["agents.research"]
}
```

This is non-normative; registries MAY surface additional metadata.

## Compatibility

**Additive.**

- `agents` is optional with default `[]`; pre-RFC-0003 packs validate unchanged.
- `nodes` minItems is unchanged (still `1`); pre-RFC packs continue to validate.
- No new required field on the existing `PackNode` shape.
- Registries and hosts that don't understand `agents[]` MAY ignore it; they continue to install the pack's nodes correctly.

Packs that publish under RFC 0003 SHOULD bump their `engines.openwop` floor to `>=1.1.0` so hosts on stricter pre-RFC engines fail-fast rather than silently dropping the agents.

## Conformance

Existing scenarios that exercise the pack surface:

- `conformance/src/scenarios/pack-registry.test.ts` — verifies registry submission/lookup round-trip.
- `conformance/src/scenarios/pack-registry-publish.test.ts` — verifies signing and verification.
- `conformance/src/scenarios/maliciousManifest.test.ts` — verifies hostile manifests are rejected.

New scenarios required to upgrade from `Active` to `Accepted`:

- `agent-pack-install.test.ts` — pack with `agents[]` is fetched, verified, validated, and the agents become resolvable via `AgentRef.agentId`.
- `agent-pack-namespace-scoping.test.ts` — manifest with cross-namespace agent IDs is rejected.
- `agent-pack-prompt-traversal.test.ts` — `systemPromptRef` with path traversal (`../`) is rejected at install time.

## Alternatives considered

1. **Separate `agent-pack.json` file.** Rejected: two file formats, two signing surfaces, two registry submission flows. The whole point of reusing node packs is that agents-only packs are operationally indistinguishable from node-only packs.
2. **Inline agents in workflow definitions.** Rejected: agents are reusable across workflows; embedding them in `WorkflowDefinition` prevents reuse, duplicates manifests, and bloats the workflow.
3. **OCI artifacts as the distribution format.** Considered for future; OCI integration is a post-v1 ecosystem item per `ROADMAP.md`. RFC 0003 ships the simpler JSON-manifest-in-tarball form first; OCI compatibility is an additive layer if needed.
4. **Ship agents as MCP servers.** Rejected: MCP exposes tools to LLM nodes; agents themselves are the LLM nodes. Conflating the two would muddle the trust boundary in `mcp-integration.md`.

## Unresolved questions

1. Should `nodes.minItems` relax from `1` to `0` once agents-only packs are proven? Defer to v1.2 minor.
2. Should `peerDependencies` keys follow a reserved `openwop.*` prefix? Current: yes for protocol-defined capabilities, vendor-prefix for vendor capabilities (matches `host-extensions.md` convention).
3. Should agent packs be discoverable through `/.well-known/openwop`? Probably no — that's a registry concern, not a host concern.

## Implementation notes (non-normative)

- Reference host install path: `hostsRegistry.fetchPack(name, version) → verifySignature → validateManifest → installNodes → installAgents`. The `installAgents` step is an append-only operation on the host's `AgentRegistry`.
- Hosts MAY hot-reload agent packs (no run termination required for newly installed agents). In-flight runs continue with the manifest version pinned at run start; new runs see the new manifest.
- Registries that wish to support OCI distribution may add an OCI digest field to the index entry; this is non-normative.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `agents[]` added to `node-pack-manifest.schema.json`.
- [ ] `node-packs.md` updated with §"Agents (RFC 0003)" subsection.
- [ ] `registry-operations.md` updated with namespace-scoping validation requirement.
- [ ] Three new conformance scenarios.
- [ ] CHANGELOG entry under v1.0.
- [ ] Reference host installs and resolves at least one agent pack.

## References

- `schemas/node-pack-manifest.schema.json`
- `schemas/agent-manifest.schema.json`
- `spec/v1/node-packs.md`
- `spec/v1/registry-operations.md`
- RFC 0002 (Agent Identity), RFC 0004 (Memory Layer)
