# Threat Model: Provider Policy Bypass

> **Scope:** AI-provider policy enforcement modes (`disabled` / `optional` / `required` / `restricted`) per `spec/v1/capabilities.md` §`aiProviders.policies`. Covers the bypass paths a workspace member, workflow author, or attacker might attempt to use a provider/model combination the workspace policy forbids.
> **Last updated:** 2026-05-01
> **Companion artifacts:** `spec/v1/capabilities.md` §`aiProviders.policies` · `spec/v1/run-options.md` · `SECURITY/invariants.yaml` (entries `provider-policy-*`).

## 1. Why this model

`capabilities.aiProviders.policies` advertises which provider-policy modes a host enforces. The four modes:

- `disabled` — provider may not be used at all.
- `optional` — no restriction (the default no-op mode).
- `required` — BYOK required (workspace must supply its own credentials).
- `restricted` — model must match the policy's `allowedModels` glob list.

These modes exist to let workspace operators control compliance, cost, and data-residency posture. A bypass would let a workflow author or run requester hit a provider/model the operator has explicitly forbidden — a direct compliance violation.

Per `the public security review plan` (Security B), the protocol's stated behavior is fail-closed: `restricted` without an allowlist denies; resolver outage falls open to `optional`. This model enumerates the bypass attempts that MUST be prevented.

## 2. Trust boundaries

```text
[Workspace admin] ── sets policy ──> [Host policy store: KMS-encrypted at rest]
                                         │
                                         │  ProviderPolicyResolver reads on demand
                                         ▼
[Run request] ── arrives ──> [Host: pre-dispatch enforcement]
                                  │
                                  │  resolve policy + check provider/model
                                  ▼
                              [Decision: permit | deny]
                                  │
                              ┌───┴───┐
                              ▼       ▼
                          permit     deny
                              │       │
                              │       └─> ProviderPolicyError emitted with reason
                              ▼
                          [LLM provider invocation]
```

Trust transitions:

- **T1: Admin → Host.** Admin sets policy via gated UI; policy persists in tenant-scoped storage.
- **T2: Run request → Host.** Run includes desired provider + model + optional `credentialRef` and `metadata`.
- **T3: Host → Resolver.** Pre-dispatch hook calls `ProviderPolicyResolver.resolveProviderPolicy({workspaceId, projectId, canvasTypeId, provider, model})`.
- **T4: Resolver → Decision.** Returns `{policy, modeScope, fieldScopes}` or fails.
- **T5: Decision → LLM.** Permit dispatches; deny emits `ProviderPolicyError` with reason.

## 3. Adversaries

| ID  | Adversary                                                 | Capability                                                                                                                                    |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Workspace member without admin role                       | Submit `POST /v1/runs` with workflow that uses provider/model the workspace policy forbids                                                    |
| A2  | Workflow author                                           | Author a workflow whose declared provider/model passes static validation but uses a different provider/model at runtime via crafted variables |
| A3  | Hostile client crafting envelopes                         | LLM emits an envelope that triggers a different provider/model than the run was authorized for                                                |
| A4  | Network attacker observing encrypted-at-rest policy store | Cannot read; policy KMS-encrypted                                                                                                             |
| A5  | Compromised admin account                                 | Sets a policy that permits the desired bypass; mitigation is audit log + alerting (out of protocol scope)                                     |

## 4. STRIDE per surface

### 4.1 Pre-dispatch enforcement (T3)

The protocol's normative requirement: every LLM call MUST go through the pre-dispatch hook before reaching the provider.

| Threat           | Vector                                                                                                              | Mitigation                                                                                                                                           | Invariant                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Authority bypass | A code path makes an LLM call without invoking the resolver                                                         | Every AI provider invocation MUST route through the host's provider-policy resolver before dispatch; `provider-policy-pre-dispatch` gates the bypass | `provider-policy-pre-dispatch`    |
| Authority bypass | Workflow declares `provider: "openai"` but at runtime uses `ai.providerOverride` to switch to `"anthropic"` mid-run | Resolver re-runs on every per-call resolution; static workflow declaration is not authoritative                                                      | `provider-policy-runtime-recheck` |

### 4.2 Disabled mode

`policy.modes` includes `disabled`. Provider is not usable.

| Threat                 | Vector                                                                                                                                    | Mitigation                                                                                              | Invariant                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Authority bypass       | Run requester supplies a `credentialRef` for the disabled provider, expecting BYOK to override                                            | `disabled` is hard-deny — no credential mechanism overrides                                             | `provider-policy-disabled-hard`     |
| Information disclosure | Resolver returns the policy reason in error envelope; reason includes provider name, leaking which providers are enabled to the requester | Error envelope only includes the policy decision + denial reason; provider list is workspace-admin info | `provider-policy-no-discovery-leak` |

### 4.3 Required mode (BYOK required)

`policy.modes` includes `required`. Workspace must supply own credentials.

| Threat           | Vector                                                                         | Mitigation                                                                                                         | Invariant                                       |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Authority bypass | Run requester omits `credentialRef`, expects fall-back to platform-managed key | `required` denies with `byok_required_but_unresolved` if no credentialRef resolves                                 | `provider-policy-required-byok-only`            |
| Authority bypass | Run requester supplies a credentialRef that resolves to a platform-managed key | CredentialRef resolution distinguishes platform-managed vs tenant-scoped; `required` mode rejects platform-managed | `provider-policy-required-distinguishes-source` |

### 4.4 Restricted mode

`policy.modes` includes `restricted`; `allowedModels` is a glob list.

| Threat           | Vector                                                                                                                                       | Mitigation                                                                                                    | Invariant                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Authority bypass | Run requester passes a model name that doesn't match any allowedModels glob                                                                  | Resolver denies with `model_not_allowed`; emits the (sanitized) `allowed: []` list                            | `provider-policy-restricted-glob`           |
| Authority bypass | `allowedModels` is unset (`null` or absent) — does the host fail-open or fail-closed?                                                        | **Fail-closed** per spec — `restricted` without allowlist denies all (`model_not_allowed` with `allowed: []`) | `provider-policy-restricted-fail-closed`    |
| Authority bypass | Run requester uses model alias (e.g., `claude-3` resolves to `claude-3-sonnet-20240229`) and the alias matches but the resolved name doesn't | Glob match runs against the canonical model name, not the alias                                               | `provider-policy-restricted-canonical-name` |

### 4.5 Resolver outage

| Threat                             | Vector                                                                   | Mitigation                                                                                                                                                              | Invariant                                   |
| ---------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Authority bypass on outage         | Resolver throws / times out — does the host fail-open or fail-closed?    | **Fail-open to `optional`** per spec (resolver outage is not a security-critical denial path; `restricted` without allowlist is the security-critical fail-closed case) | `provider-policy-resolver-outage-fail-open` |
| Authority bypass on partial outage | Resolver returns partial fields (`policy` set but `modeScope` undefined) | Policy decision is computed from the returned fields; missing fields treated as default-permissive                                                                      | `provider-policy-partial-resolution`        |

### 4.6 Audit trail

| Threat      | Vector                                                                                | Mitigation                                                                                      | Invariant                          |
| ----------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| Repudiation | Workspace admin claims a denial decision was a bug                                    | Resolver emits `ProviderPolicyResolution` audit event with `policy`, `modeScope`, `fieldScopes` | `provider-policy-audit-emit`       |
| Repudiation | Audit event omits which scope (workspace / project / canvas-type) supplied each field | Provenance fields (`fieldScopes`) MUST identify the source layer per field                      | `provider-policy-audit-provenance` |

## 5. Invariants (MUST NOT)

| ID                                              | Statement                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider-policy-pre-dispatch`                  | LLM provider invocations MUST NOT proceed without invoking the policy resolver.                                                                                          |
| `provider-policy-runtime-recheck`               | Policy MUST be re-evaluated at every LLM call; static workflow declaration alone MUST NOT pass enforcement.                                                              |
| `provider-policy-disabled-hard`                 | `disabled` mode MUST be a hard deny; no credentialRef, override, or escalation mechanism MUST permit a `disabled` provider invocation.                                   |
| `provider-policy-no-discovery-leak`             | Policy denial error envelopes MUST NOT enumerate which providers are enabled or disabled outside the requested provider.                                                 |
| `provider-policy-required-byok-only`            | `required` mode MUST deny invocations whose resolved credentialRef is not workspace-scoped or user-scoped (i.e., platform-managed keys are insufficient).                |
| `provider-policy-required-distinguishes-source` | The credentialRef resolution path MUST distinguish platform-managed credentials from tenant/user-scoped credentials so `required` enforcement can detect the difference. |
| `provider-policy-restricted-glob`               | `restricted` mode MUST reject models that don't match any entry in `allowedModels`.                                                                                      |
| `provider-policy-restricted-fail-closed`        | `restricted` mode without an `allowedModels` list MUST deny all (fail-closed).                                                                                           |
| `provider-policy-restricted-canonical-name`     | Glob matching MUST run against the canonical model name (post-alias-resolution), not against any client-supplied alias.                                                  |
| `provider-policy-resolver-outage-fail-open`     | Resolver outage / timeout MUST fall open to `optional` mode (no denial); this is the explicit non-security-critical path.                                                |
| `provider-policy-partial-resolution`            | Missing fields in the resolver response MUST be treated as default-permissive for that field; partial responses MUST NOT cause silent fail-closed.                       |
| `provider-policy-audit-emit`                    | Every policy decision MUST emit a `ProviderPolicyResolution` audit event including `policy`, `modeScope`, `fieldScopes`.                                                 |
| `provider-policy-audit-provenance`              | The `fieldScopes` audit field MUST identify which layer (workspace / project / canvas-type) supplied each policy field.                                                  |

## 6. Residual risks

- **Compromised admin account.** A compromised workspace admin can set a policy that permits the desired bypass. No protocol-level defense; covered by audit log + alerting per host operator policy.
- **Provider-side bypass.** A provider that ignores the host's restrictions (e.g., a model alias that the provider routes to a forbidden model) sits outside protocol enforcement. Mitigation is provider-trust + the canonical-name invariant above.
- **Cost / quota bypass.** A workflow that fits the policy but generates high cost is out of scope here (cost attribution is `observability.md` §"AI cost"; quota enforcement is per-host).
- **Concurrency at decision time.** Two policy changes within the same millisecond may produce a non-linearizable decision. Mitigation is server-internal; covered by the host's transactional store. Not a protocol invariant.

## 7. Verification

`SECURITY/invariants.yaml` maps each MUST-NOT to test globs. Public-repo verification: `conformance/src/scenarios/policies.test.ts` covers the v1.0 discovery-shape contracts.

Host-specific verification MUST cover enforcement behavior end-to-end for every advertised provider-policy mode, including runtime rechecks, BYOK-source distinction, canonical provider names, partial-resolution behavior, and audit provenance.

## 8. References

- `SECURITY.md` — disclosure policy.
- `SECURITY/invariants.yaml` — invariant → test mapping.
- `spec/v1/capabilities.md` §`aiProviders.policies` — discovery shape.
- `spec/v1/run-options.md` §"Credential references" — credentialRef semantics.
- `spec/v1/capabilities.md` §`aiProviders.policies` — provider-policy discovery shape.
- `openwop/openwop@0bebfb0` — denial-reason enum alignment.
- `openwop/openwop@f7e29d6` — vendor-neutral conformance scenarios.
