# Threat Model: Node Packs

> **Scope:** The node-pack ecosystem — manifest authoring, registry submission, signature verification, host-side resolution, and sandboxed execution. Covers tampering at every link in the supply chain plus runtime sandbox escape.
> **Last updated:** 2026-05-01
> **Companion artifacts:** `spec/v1/node-packs.md` · `spec/v1/registry-operations.md` · `SECURITY/invariants.yaml` (entries `node-pack-*`).

## 1. Why this model

Node packs are user-installed code that runs inside the host's process. The threat surface is the same as any plugin/extension marketplace — the protocol's role is to specify the trust contract end-to-end so that packs from different sources cannot bypass it.

Per `the public security review plan` (Security B), pack ecosystems are inherently risky and need explicit threat modeling before any "industry standard" claim. This model enumerates the trust boundaries and the invariants that close each one.

## 2. Trust boundaries

```text
[Pack author] ── publishes ──> [Registry: validate manifest, verify signature, store tarball]
                                       │
                                       │  serve via GET /v1/packs/...
                                       ▼
[Host operator] ── approves ──> [Workspace approved-pack list]
                                       │
                                       │  resolver → fetch tarball
                                       ▼
                              [Host: verify signature, extract tarball, load module in sandbox]
                                       │
                                       │  execute node
                                       ▼
                              [Sandbox: limited capabilities]
                                       │
                                       ▼
                              [Workflow continues with node result]
```

Trust transitions:

- **T1: Author → Registry.** Author signs the tarball with Ed25519 key whose public half is in the registry's keychain.
- **T2: Registry → Host.** Host fetches the tarball and the detached `.sig`; verifies signature against the keychain.
- **T3: Operator → Host.** Workspace admin (per `MAINTAINERS.md`-host-equivalent) approves which packs are loadable per workspace.
- **T4: Host → Sandbox.** Host loads the verified pack module in a vm-context-isolated sandbox with no Node-builtin access.
- **T5: Sandbox → Workflow.** Pack-emitted output is treated as untrusted content (per `threat-model-prompt-injection.md`).

## 3. Adversaries

| ID  | Adversary                   | Capability                                                                                        |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| A1  | Malicious pack author       | Publishes a pack that attempts to escape the sandbox or exfiltrate data                           |
| A2  | Compromised registry        | Serves a malicious tarball under a known pack name; serves a forged signature                     |
| A3  | Network attacker (MITM)     | Sits between host and registry; can swap tarball or signature mid-flight                          |
| A4  | Compromised pack-author key | Author's private key leaks; attacker publishes packs as if they were the author                   |
| A5  | Hostile workspace admin     | Approves a malicious pack to a workspace they control                                             |
| A6  | Malicious manifest          | Manifest contains path-traversal entries, oversized payload, or shape that exhausts the validator |

## 4. STRIDE per surface

### 4.1 Manifest validation (registry side, T1)

Per `spec/v1/registry-operations.md` §"Submission validation."

| Threat              | Vector                                                                          | Mitigation                                                                   | Invariant                          |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| Tampering           | Manifest declares `name: "core.foo"` while tarball entries reference `core.bar` | Registry rejects with `manifest_name_mismatch` per `openwop/openwop@c0d63ae` | `node-pack-manifest-name-match`    |
| Tampering           | Manifest version differs from URL version segment                               | Registry rejects with `manifest_version_mismatch`                            | `node-pack-manifest-version-match` |
| Resource exhaustion | Tarball exceeds size cap                                                        | Registry rejects with `tarball_too_large` (50 MB cap per ref impl)           | `node-pack-tarball-size-cap`       |
| Resource exhaustion | Manifest exceeds size cap                                                       | Registry rejects with `tarball_manifest_too_large` (256 KB cap)              | `node-pack-manifest-size-cap`      |
| Resource exhaustion | Tarball entry exceeds size cap                                                  | Registry rejects with `tarball_entry_too_large` (5 MB cap)                   | `node-pack-entry-size-cap`         |
| Path-traversal      | Tarball entry includes `../` segments or absolute paths                         | Registry rejects with `tarball_path_traversal`                               | `node-pack-path-traversal`         |
| Tampering           | Manifest declares scope `core.*` from a non-platform author                     | Registry rejects with `invalid_pack_scope`                                   | `node-pack-scope-author-match`     |
| Privilege / integrity | A `role: "skill"` `AgentManifest` (RFC 0131) declares stateful memory (`memoryShape.conversation`/`longTerm`) or omits `handoff` — a stateful worker that breaks the pure task→return contract + replay determinism (RFC 0041) | Schema-encoded reject: the `agent-manifest.schema.json` `if role==="skill"` conditional fails validation ⇒ registry/host rejects at publish/install (`pack_validation_failed`) | `agent-skill-profile-stateless`    |

### 4.2 Signature verification (T1, T2, T3)

Detached Ed25519 signature served via `GET /v1/packs/{name}/-/{version}.sig`.

| Threat         | Vector                                                                    | Mitigation                                                                                              | Invariant                                 |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Spoofing       | Attacker submits tarball with forged signature                            | Registry verifies signature against published keychain BEFORE accepting                                 | `node-pack-sig-publish`                   |
| Spoofing       | Host fetches tarball without verifying signature                          | Host MUST verify Ed25519 signature against keychain BEFORE loading                                      | `node-pack-sig-host-verify`               |
| Spoofing       | Host accepts a signature signed by a key NOT in the keychain              | Host rejects with `signature_unknown_key`                                                               | `node-pack-sig-key-in-keychain`           |
| Replay         | Attacker serves an older signed version after the version has been yanked | Yanked versions MUST NOT serve signatures (per `openwop/openwop@434c8f2` `404 signature_not_available`) | `node-pack-sig-no-yanked`                 |
| MITM           | Network attacker swaps tarball mid-fetch                                  | Signature verification catches the swap (T2 boundary)                                                   | `node-pack-sig-host-verify` (covers MITM) |
| Key compromise | Pack-author's private key leaks                                           | Detection via key revocation in keychain; revoked keys reject all signatures                            | `node-pack-sig-revocation`                |

### 4.3 Workspace approval (T3)

Per the two-tier registry pattern (platform catalog + workspace approved list).

| Threat               | Vector                                                       | Mitigation                                                                  | Invariant                       |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------- |
| Authority bypass     | Workspace member loads pack not in workspace's approved list | Resolver rejects with `pack_not_approved`; approval is workspace-admin-only | `node-pack-approval-required`   |
| Authority bypass     | Pack auto-approves itself via manifest field                 | Manifest fields cannot grant approval; approval is host-state               | `node-pack-approval-host-state` |
| Privilege escalation | Pack approved at one workspace runs in a different workspace | Resolver scopes approval per workspace; cross-workspace use rejected        | `node-pack-approval-scope`      |

### 4.4 Sandbox execution (T4, T5)

Host loads pack module in `vm.createContext` with no built-in `require`, no network unless declared, no filesystem unless declared.

| Threat                 | Vector                                                              | Mitigation                                                                  | Invariant                            |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| Sandbox escape         | Pack uses `process` global to access host process                   | Sandbox context omits `process`                                             | `node-pack-sandbox-no-process`       |
| Sandbox escape         | Pack uses `eval` or `Function` constructor with host-side string    | Sandbox enforces a no-eval policy via vm options                            | `node-pack-sandbox-no-eval`          |
| Privilege escalation   | Pack performs network I/O without declaring `requires: ["network"]` | Sandbox blocks unauthorized fetch / http; pack receives capability error    | `node-pack-sandbox-network-gated`    |
| Privilege escalation   | Pack performs filesystem I/O without declaring `requires: ["fs"]`   | Sandbox blocks unauthorized fs; same shape                                  | `node-pack-sandbox-fs-gated`         |
| Information disclosure | Pack reads environment variables                                    | Sandbox context omits `process.env`; explicit `secrets` capability required | `node-pack-sandbox-no-env`           |
| Resource exhaustion    | Pack runs CPU-bound infinite loop                                   | Per-invocation timeout enforced by host (default 30s)                       | `node-pack-sandbox-timeout`          |
| Resource exhaustion    | Pack allocates unbounded memory                                     | Per-invocation memory cap enforced by host (default 256 MB)                 | `node-pack-sandbox-memory-cap`       |
| Information disclosure | Pack reads other workflow runs' state via global                    | Sandbox context is per-invocation; cross-invocation globals are reset       | `node-pack-sandbox-isolated-context` |

### 4.5 Pack output → workflow

| Threat               | Vector                                                        | Mitigation                                                                 | Invariant                                                                   |
| -------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Tampering            | Pack returns output containing prompt-injection content       | Output treated as untrusted content per `threat-model-prompt-injection.md` | `node-pack-output-untrusted` (cross-references prompt-injection invariants) |
| Privilege escalation | Pack output claims to set `decidedBy: 'admin'` on an approval | `decidedBy` host-derived only; pack output cannot influence                | `node-pack-no-decidedby-emit`                                               |

## 5. Invariants (MUST NOT)

| ID                                   | Statement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-pack-manifest-name-match`      | Registries MUST reject submissions where the manifest's `name` field does not match the URL path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `node-pack-manifest-version-match`   | Registries MUST reject submissions where the manifest's `version` field does not match the URL path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `node-pack-tarball-size-cap`         | Registries MUST enforce a tarball size cap (default 50 MB; configurable per registry).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `node-pack-manifest-size-cap`        | Registries MUST enforce a manifest size cap (default 256 KB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `node-pack-entry-size-cap`           | Registries MUST enforce a per-entry size cap (default 5 MB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `node-pack-path-traversal`           | Registries MUST reject tarballs whose entries include `..` segments or absolute paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `node-pack-scope-author-match`       | Registries MUST reject submissions whose declared scope is not authorized for the submitting author (`core.*` is platform-only; `vendor.<org>.*` requires org authorization).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `agent-skill-profile-stateless`      | Registries/hosts MUST reject a `role: "skill"` `AgentManifest` (RFC 0131 §B) that omits `handoff` or declares `memoryShape.conversation`/`memoryShape.longTerm` as `true`. The `agent-manifest.schema.json` `if role==="skill"` conditional is the enforcing gate — the violation is a malformed manifest (an author error caught at publish/install validation), NOT an RFC 0072 §C `degraded[]` runtime tier. Keeps a composable, task-scoped skill stateless + replay-clean (RFC 0041); persistent/multi-turn memory belongs to the composing assistant/roster agent (RFC 0039).                                        |
| `node-pack-sig-publish`              | Registries MUST verify the Ed25519 signature against the published keychain BEFORE accepting a publish.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `node-pack-sig-host-verify`          | Hosts MUST verify the Ed25519 signature against the registry's keychain BEFORE loading a pack module.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `node-pack-sig-key-in-keychain`      | Hosts MUST reject signatures signed by a key not present in the registry's keychain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `node-pack-sig-no-yanked`            | Yanked versions MUST NOT serve their signature blob (`404 signature_not_available`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `node-pack-sig-revocation`           | Revoked keychain entries MUST cause subsequent signature verification to fail; in-flight runs MAY continue but new resolutions MUST reject.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `node-pack-approval-required`        | Hosts MUST reject pack-loading attempts for packs not in the workspace's approved list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `node-pack-approval-host-state`      | Pack approval MUST be host-managed state; manifest fields MUST NOT grant approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `node-pack-approval-scope`           | Pack approval MUST be scoped per workspace; cross-workspace use MUST require separate approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node-pack-sandbox-no-process`       | Sandbox context MUST NOT expose the Node `process` global.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `node-pack-sandbox-no-eval`          | Sandbox context MUST disable `eval` and `Function` constructor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node-pack-sandbox-network-gated`    | Network I/O from a pack MUST be gated on the pack's declared `requires: ["network"]` capability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `node-pack-sandbox-fs-gated`         | Filesystem I/O from a pack MUST be gated on the pack's declared `requires: ["fs"]` capability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `node-pack-sandbox-no-env`           | Sandbox context MUST NOT expose `process.env`; environment access requires the `secrets` capability via the host's secret-resolver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `node-pack-sandbox-timeout`          | Per-invocation execution MUST be bounded by a host-enforced timeout (default 30s; configurable).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `node-pack-sandbox-memory-cap`       | Per-invocation memory MUST be bounded by a host-enforced cap (default 256 MB; configurable).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `node-pack-sandbox-isolated-context` | Sandbox context MUST be reset between invocations; cross-invocation global state MUST NOT leak.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node-pack-output-untrusted`         | Pack output MUST be treated as untrusted content; downstream prompt-injection invariants apply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node-pack-no-decidedby-emit`        | Pack output MUST NOT influence the `decidedBy` field on any persisted approval / refine event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `artifact-schema-compile-bounded`    | Hosts MUST bound compilation of third-party artifact schemas shipped by artifact-type packs (`kind: "artifact-type"`, RFC 0071) — rejecting schemas that exceed host limits on serialized byte size, `$ref` nesting depth, and total keyword/subschema count, and compiling under a wall-clock timeout — so a schema bomb (`$ref` recursion, keyword explosion, oversized payload, catastrophic-backtracking `pattern`) cannot cause denial of service. Over-bounds packs are rejected at registry `PUT`/install with `pack_validation_failed`. The artifact-schema analog of the tarball/manifest size caps above. |

### Distributed artifact schemas (T6)

Artifact-type packs (RFC 0071) extend the supply-chain surface: in addition to a runtime artifact, an artifact-type pack ships one or more **JSON Schemas** (`artifactTypes[].schemaRef`) that the engine compiles and runs at install + artifact-validation time. An attacker who can publish (or compromise the publisher of) such a pack can ship a _schema bomb_ — pathological `$ref` recursion, keyword-count explosion, an oversized document, or a catastrophic-backtracking `pattern` — that exhausts CPU or memory when the engine compiles it. This is mitigated by `artifact-schema-compile-bounded`: the same bounded-input discipline already applied to tarballs and manifests (`node-pack-*-size-cap`), extended to the compiled schema. The server-free conformance floor (`artifact-schema-compile-bounded.test.ts`) asserts the contract is present and that a reference finite bound catches the bomb classes.

## 6. Residual risks

- **Side-channel attacks.** A malicious pack might infer secrets via timing channels even with no direct access. Mitigation is host operator policy (run packs in dedicated processes for high-sensitivity workflows).
- **Supply-chain compromise of the npm/PyPI publisher.** A compromised publisher can replace the `@openwop/openwop-conformance` package with a malicious version. Out of scope; covered by general supply-chain hygiene (npm provenance, OIDC-trusted-publisher per `ROADMAP.md`).
- **Pack-author key compromise without revocation.** If a key compromise isn't detected and revoked, an attacker can publish malicious versions under a trusted name. Mitigation is `node-pack-sig-revocation` once detected.
- **vm-context limitations.** Node's `vm` module is not a hard sandbox in the security sense; a determined attacker can sometimes escape via prototype pollution. Hard isolation requires process-level (Worker, child_process) or container-level (Firecracker, gVisor) sandboxing — these are advisory recommendations, not v1 requirements.

## 7. Verification

`SECURITY/invariants.yaml` maps each MUST-NOT to test globs. Public-repo verification:

- Conformance: `pack-registry.test.ts` and `pack-registry-publish.test.ts` cover the registry-tier invariants.
- Conformance: `pack-registry-publish.test.ts` covers path-traversal, oversize, signature format, scope/author binding, and publish-time validation scenarios.

Host-specific verification MUST additionally cover sandbox-tier invariants such as process/env isolation, filesystem and network gates, timeout and memory caps, and per-invocation context reset.

## 8. References

- `SECURITY.md` — disclosure policy.
- `SECURITY/invariants.yaml` — invariant → test mapping.
- `spec/v1/node-packs.md` — manifest format, signature format, registry HTTP API.
- `spec/v1/registry-operations.md` — submission validation, deprecation, yank, key-rotation lifecycle.
- `spec/v1/node-packs.md` §"Host execution obligations" — sandbox and runtime requirements.
