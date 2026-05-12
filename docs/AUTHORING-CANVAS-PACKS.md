# Authoring Canvas Packs

> **Status: v1 (2026-05-12).** Patterns, conventions, and anti-patterns for authoring + publishing OpenWOP node packs that contain canvas-bound executor logic. Targets the next 30 executors in the Phase B+C canvas-packs delivery (`vendor.myndhyve.{app-builder, ads-studio, campaign-sequence, landing-page}`). Pairs with `CANVAS-PACKS-INVENTORY.md` (the scope contract) and the Stage 3 pack-generator tooling.

---

## When to use this guide

You're authoring a new OpenWOP node pack and at least one of:

- The pack ships **custom executor logic** (not just editor presets that map to `core.ai.callPrompt`)
- The pack consumes **canvas-bound state** (current page, current entity, session-scoped data)
- The pack will be **published to `packs.openwop.dev`** for consumption by other openwop hosts (not host-private)

If your pack is entirely editor-preset typeIds that workflow authors drop into pre-configured `core.*` chains, see `CANVAS-PACKS-INVENTORY.md` §"Editor presets — not pack-publishable" — your work is workflow-template publishing (separate spec extension), not node-pack publishing.

---

## The 30-minute path: generate → fill in → publish

The generator + Stage 2 CI gates collapse pack-publishing to deterministic stages:

```bash
# 1. Generate the source tree
node scripts/new-pack.mjs vendor.<org>.<pack>

# 2. Edit pack.json + per-node JSON schemas + index.mjs (executor logic)
# 3. Build + sign
node scripts/build-pack-tarball.mjs \
  --pack vendor.<org>.<pack> --signed \
  --key ~/.openwop-keys/<org>-internal-1.private.pem \
  --key-id <org>-internal-1

# 4. Drop the tarball + sig + manifest into the registry tree
cp dist/packs/vendor.<org>.<pack>-1.0.0.tgz \
   registry/v1/packs/vendor.<org>.<pack>/-/1.0.0.tgz
base64 -d < dist/packs/vendor.<org>.<pack>-1.0.0.sig.b64 \
   > registry/v1/packs/vendor.<org>.<pack>/-/1.0.0.sig
cp dist/packs/vendor.<org>.<pack>-1.0.0.manifest.json \
   registry/v1/packs/vendor.<org>.<pack>/-/1.0.0.json

# 5. Regenerate the indices
node registry/scripts/build-index.mjs

# 6. Commit, open PR, merge after Stage 2 gates pass
```

For a small pack (1–3 typeIds, simple schemas, no business-logic refactor), this is a 30-minute path end-to-end. The Stage 2 CI gates (`registry-publish.yml`) catch the common authoring mistakes before merge.

For larger canvas-bound packs (e.g., `vendor.myndhyve.app-builder` at ~1066 LOC of executor logic), the time goes into **§4 Refactoring myndhyve-coupled executors** below, not the generation.

---

## 1. Pack identity rules

| Field | Rule | Why |
|---|---|---|
| `name` | Reverse-DNS: `(core\|vendor\|community\|private).<org>.<rest>` | spec/v1/node-packs.md §Naming |
| `name` (scope) | `core.*` reserved for openwop-project. `vendor.<org>.*` requires registered namespace claim. `community.<author>.*` is open-publish. `private.*` MUST NOT appear on `packs.openwop.dev` (host-internal only) | registry-operations.md §Step 1 |
| `version` | SemVer 2.0.0 | spec/v1/node-packs.md §Versioning |
| `signing.keyId` | MUST be registered in `.well-known/openwop-registry.json` `signingKeys[]` AND authorized for the pack's namespace via `permittedNamespaces` | enforced by `registry/scripts/verify-signatures.mjs` |
| `runtime.language` | `javascript` (most packs), `wasm` (RFC 0008 packs), `remote` (agent-only) | enforced by `schemas/registry-version-manifest.schema.json` |

---

## 2. The executor contract

Every executor is a `defineNode({ id, execute })` call. The `execute` function is an async generator that yields events:

```typescript
import { defineNode } from '@openwop/workflow-engine';

export const myNode = defineNode({
  id: 'vendor.org.pack.action',
  version: '1.0.0',
  label: 'Display Name',
  description: 'One-line description for editor + docs.',
  category: 'data' | 'integration' | 'ai' | 'control' | ...,
  role: 'action' | 'side-effect' | 'gate' | 'iterator' | ...,
  capabilities: ['cacheable', 'side-effectful', 'streaming', ...],

  execute: async function* (ctx) {
    // 1. Bail early on cancellation
    if (ctx.signal?.aborted) {
      yield { type: 'error', error: { code: 'aborted', message: 'cancelled' } };
      return;
    }

    // 2. Validate host capability availability
    ensureRequiredCapabilities(ctx);

    // 3. Read inputs (validated by engine against inputSchemaRef)
    const { fieldA, fieldB } = ctx.inputs;

    // 4. Do work, possibly via host capabilities
    try {
      const result = await ctx.someHostCapability.doThing({ fieldA, fieldB });
      yield { type: 'output', data: result };
    } catch (err) {
      yield {
        type: 'error',
        error: {
          code: 'execution_failed',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
});
```

### What you MUST do

- **Use `ctx.log()`**, not `console.log` / `createScopedLogger` / etc. `ctx.log` routes through the engine's per-run log collector + the host's observability stack.
- **Use `ctx.signal`** to honor cancellation. The engine sets `signal.aborted = true` when a run is cancelled mid-execution; honor it before starting expensive work.
- **Yield `error` events**, don't throw. The engine catches uncaught throws but the resulting envelope is opaque; explicit `error` events let downstream nodes branch on `error.code`.
- **Use `host_capability_missing` error code** when `ctx.someCapability` is absent. This signals the host is misconfigured, not the executor.
- **Use `cacheable` capability** when your node's output is deterministic for a given (config, input) pair. The engine's Layer-2 cache will dedupe replays.

### What you MUST NOT do

- **Don't import myndhyve services directly.** No `import { aiService } from '@/core/ai/services/AIOrchestrationService'`. Use `ctx.callAI(...)` (host.aiEnvelope) instead.
- **Don't read Zustand stores directly.** No `useCampaignStudioStore.getState()`. Use `ctx.host.canvas.read(...)` instead.
- **Don't `console.log`.** Pure `ctx.log()`.
- **Don't throw raw errors.** Yield typed error events.
- **Don't store state across `execute()` invocations.** Executors must be stateless — the engine may dispatch the same node concurrently across runs.

---

## 3. Host capabilities — the abstraction layer

Canvas-bound packs DON'T directly access myndhyve-specific state. They go through `host.*` capability interfaces declared in `spec/v1/host-capabilities.md`:

| Capability | Contract | Used by |
|---|---|---|
| `host.aiEnvelope` | `ctx.aiEnvelope.generate({...})` → typed envelope | AI-generation nodes |
| `host.promptLibrary` | `ctx.promptLibrary.get(promptId)` → system prompt | nodes that resolve prompts by id |
| `host.canvas` | `ctx.host.canvas.{read,write,create,crossInvoke}` | canvas-state read/write |
| `host.kanban` | (TBD) kanban operations | stack-item manipulation |
| `host.brand` | brand asset access | brand workflow nodes |
| `host.entities` | entity CRUD | entity management |
| `host.webResearch` | web research queries | research/market-intel nodes |

**Declaration:** every host capability your pack consumes MUST be declared in `pack.json` `peerDependencies`:

```json
"peerDependencies": {
  "host.aiEnvelope": "supported",
  "host.canvas": "supported"
}
```

Hosts advertise capabilities via `/.well-known/openwop` (per `host-capabilities.md`). At pack-install time, the host's `verifyManifest` step refuses any pack whose `peerDependencies` aren't satisfied — your pack fails fast on hosts that don't support the capabilities it needs.

---

## 4. Refactoring myndhyve-coupled executors

This is where the real engineering effort lives. The Phase A inventory (`CANVAS-PACKS-INVENTORY.md`) identified 30 real executors in `src/canvas-types/` that need refactoring. Each one falls into one of three coupling categories.

### Category I: host-capability proxy (1–3 hours per executor)

The executor imports a myndhyve service that has a direct openwop host-capability equivalent.

| Myndhyve import | OpenWOP equivalent |
|---|---|
| `import { aiService } from '@/core/ai/services/AIOrchestrationService'` | `ctx.callAI({...})` or `ctx.aiEnvelope.generate({...})` |
| `import { createScopedLogger } from '@/core/utils/logger'` | `ctx.log(level, message, data)` |
| `import { useCampaignStudioStore } from '@/core/canvas-types/campaign-studio/stores/...'` | `ctx.host.canvas.read({ scope: 'currentPage' })` |
| `import { getApprovalRequestService } from '@/core/workflow/services/approvalRequest'` | engine-provided via `yield { type: 'suspend', ... }` |

Refactor steps:

1. Identify each myndhyve import in the executor file.
2. Replace with the corresponding `ctx.*` call.
3. Add the consumed capability to `pack.json` `peerDependencies`.
4. Verify the engine version that exposes the `ctx` accessor (some Stage 1 work may be required to extend NodeContext).

### Category II.a: business logic to bundle inside the pack (2–4 hours)

The executor imports a myndhyve-specific service that has NO openwop equivalent and shouldn't become one (too narrow for cross-host abstraction).

```javascript
// Before (myndhyve-coupled)
import { AdBriefExtractor } from '@/core/ads-studio/brief/AdBriefExtractor';

// After (bundled inside pack)
import { extractBrief } from './adBriefExtractor.mjs';  // Local file inside pack
```

The pack tarball ships its own implementation. The build step (`scripts/build-pack-tarball.mjs`) bundles every file under the pack directory into the `.tgz`. The host loads `index.mjs` which imports siblings.

**When to bundle vs. lift to a host capability:**

- **Bundle** if the logic is single-pack-specific (only `ads.brief.extract` uses `AdBriefExtractor`).
- **Lift to host capability** if 2+ packs need it (e.g., `host.brand` is shared by `vendor.myndhyve.brand` + `vendor.myndhyve.ads-studio`). Spec change required.

### Category II.b: new host capability needed (4–8 hours + spec work)

The executor needs functionality that doesn't exist in openwop yet AND will be needed by multiple packs.

Example: `host.canvas.read({ scope: 'currentPage' })` is needed by `ads.brief.extract`, `landing.content.generate`, AND `brief.kernel.generate`. The right move is to add this method to `host.canvas` in the spec (Stage 1 work).

Flow:

1. Open a spec PR adding the new method to `spec/v1/host-capabilities.md`.
2. Extend `@openwop/workflow-engine` `NodeContext` type to surface the new method.
3. Implement the new method in the myndhyve host adapter.
4. Then refactor the executor to consume the new `ctx.host.canvas.read(...)`.

Phase B (the App Builder reference pack) likely surfaces 1–2 Category II.b cases. Phase C (Campaign Studio packs) probably surfaces 3–6 more. Plan accordingly.

### Category III: data schemas (15 minutes per typeId)

The executor imports TypeScript types from myndhyve.

```typescript
// Before
import type { AdBriefModel } from '@/core/ads-studio/types';

// After
// (no import; the JSON Schema in pack/schemas/brief.input.json defines the
// shape; the executor consumes the validated value at runtime)
```

Project the TypeScript types to JSON Schema:

1. Open the myndhyve TypeScript type file.
2. For each field, write the corresponding JSON Schema entry.
3. Drop required fields, ranges, enums, descriptions into the schema.
4. Reference from `pack.json` via `inputSchemaRef` / `outputSchemaRef` / `configSchemaRef`.

---

## 5. Anti-patterns (don't ship these)

| Anti-pattern | Why it's wrong | Fix |
|---|---|---|
| Importing from `@/core/...` in the executor | Couples your pack to a specific host implementation; breaks on any other openwop host | Use `ctx.*` accessors |
| Reading workflow state via `globalThis` | Side-effects that the engine can't replay | Use `ctx.host.canvas.read(...)` |
| Catching errors silently | Hidden failure modes | Yield typed `error` events |
| Throwing instead of yielding | Engine envelope is opaque | Always yield `error` events |
| `console.log` | Doesn't route through observability | `ctx.log()` |
| Setting `peerDependencies` you don't use | Hosts will refuse to install needlessly | Only declare what you call |
| Schema with `additionalProperties: true` everywhere | Breaks input validation | Set `false` unless you specifically need open-shape |
| Missing `description` on schema fields | Workflow authors can't tell what your inputs mean | Always describe each field |
| Storing state across `execute()` invocations | Non-deterministic across replays + concurrent dispatches | Pure-functional executors |
| Hardcoding workspace/user ids | Multi-tenant escape | Use `ctx.principal` / `ctx.workspaceId` |

---

## 6. Per-pack checklist (operator-side)

Before opening the PR:

- [ ] `pack.json` `name` matches the directory path
- [ ] `pack.json` `version` matches the file path (`1.0.0.tgz` ↔ `"version": "1.0.0"`)
- [ ] `signing.keyId` references a key in `registry/keys/` AND in `signingKeys[]` AND authorized for namespace
- [ ] `peerDependencies` only lists capabilities the executor actually uses
- [ ] Every typeId in `nodes[]` has all three schemas (config/input/output)
- [ ] Every schema is valid JSON + draft 2020-12 conformant
- [ ] No `console.log` in `index.mjs`; pure `ctx.log()`
- [ ] No `import` from `@/core/` or `@/canvas-types/` — all-`ctx.*`
- [ ] Built tarball, sig, integrity files are at `dist/packs/`
- [ ] Tarball + binary sig + manifest copied into `registry/v1/packs/<name>/-/1.0.0.{tgz,sig,json}`
- [ ] `node registry/scripts/build-index.mjs` ran + indices updated
- [ ] PR description references the typeIds added + any new `host.*` capabilities consumed
- [ ] Conformance scenario authored at `conformance/src/scenarios/pack-fetch-verify-<pack-name>.test.ts` (Stage 5+ requirement)

If any of these fail, the Stage 2 CI gates (`registry-publish.yml`) will block the merge. That's the safety net. The checklist is the cost-avoidance step.

---

## 7. After merge

The WIF auto-deploy publishes to `packs.openwop.dev` within ~2 min of merge to main. Verify with:

```bash
curl -s 'https://packs.openwop.dev/v1/packs/vendor.<org>.<pack>/-/1.0.0.json' | jq .signing
```

If the integrity hash or signing keyId is wrong, the deploy succeeded but consumers will refuse to install. Audit the per-pack `index.json` against the manifest hash.

---

## 8. See also

- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — pack manifest format, registry HTTP API, `peerDependencies` semantics
- [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) — `host.*` capability contracts (currently DRAFT v1)
- [`spec/v1/registry-operations.md`](../spec/v1/registry-operations.md) — namespace claims, signing-key registration, publish lifecycle
- [`docs/CANVAS-PACKS-INVENTORY.md`](./CANVAS-PACKS-INVENTORY.md) — current scope (30 executors, 4 sub-packs)
- [`registry/README.md`](../registry/README.md) — registry layout + signing-key + namespace assignment table
- [`examples/packs/vendor-template/`](../examples/packs/vendor-template/) — pack source-tree skeleton (input to `scripts/new-pack.mjs`)
- [`scripts/new-pack.mjs`](../scripts/new-pack.mjs) — pack generator
- [`scripts/build-pack-tarball.mjs`](../scripts/build-pack-tarball.mjs) — deterministic tarball builder + signer
- [`registry/scripts/verify-signatures.mjs`](../registry/scripts/verify-signatures.mjs) — CI sig-verification gate
- [`registry/scripts/conformance-check.mjs`](../registry/scripts/conformance-check.mjs) — CI structural conformance gate
- [`.github/workflows/registry-publish.yml`](../.github/workflows/registry-publish.yml) — CI pipeline running the three gates above
