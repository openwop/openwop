# RFC 0025: Test-mode Registry Namespace

| Field | Value |
|---|---|
| **RFC** | 0025 |
| **Title** | Test-mode registry namespace for conformance publish-error catalog |
| **Status** | `Draft` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-19 |
| **Updated** | 2026-05-19 |
| **Affects** | `spec/v1/node-packs.md` (new §"Test-mode registry namespace") · `schemas/capabilities.schema.json` (new `packs.testMode` block) · `api/openapi.yaml` (new `/v1/packs-test/*` endpoints) · `conformance/src/scenarios/pack-registry-publish.test.ts` (26 todos → behavioral) |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Adds an optional `/v1/packs-test/*` registry namespace that mirrors the production `/v1/packs/*` PUT/GET/DELETE surface against an isolated catalog, gated behind a new optional `capabilities.packs.testMode` advertisement. Lets the conformance suite exercise the documented 19-code publish error catalog (`invalid_pack_name`, `invalid_pack_scope`, `tarball_too_large`, `manifest_mismatch`, …) without `packs:publish` scope on the real registry — closes the 26-`it.todo()` gap in `conformance/src/scenarios/pack-registry-publish.test.ts`.

## Motivation

Per `pack-registry-publish.test.ts` line 5-22, the publish path is gated on `packs:publish` scope plus a binary tarball upload. Round-trip scenarios from a black-box suite have two options:

1. **Super-admin scope** on the host under test. **Rejected** — gives the suite the ability to stomp on the real catalog. Non-starter for v1.
2. **Test-mode namespace** that mirrors the real surface against an isolated catalog. Defined here.

Without option 2, the 19 documented error codes (`node-packs.md` §"PUT /v1/packs/{name}/-/{version}.tgz") have no conformance coverage. Implementers learn the error catalog by reading the spec; cross-host divergence on error-code wording, status codes, and the granular/composite pair (e.g. `manifest_mismatch` vs `manifest_{name,version}_mismatch`) goes undetected.

## Proposal

### §A Capability flag

```diff
   "packs": {
     "type": "object",
     "properties": {
+      "testMode": {
+        "type": "object",
+        "description": "Optional sample-namespaced /v1/packs-test/* surface that mirrors /v1/packs/* against an isolated catalog. Lets conformance exercise the publish error catalog without packs:publish scope on the real registry.",
+        "properties": {
+          "supported": { "type": "boolean" },
+          "isolated": { "type": "boolean", "description": "MUST be true when supported is true — guarantees the test catalog is separate from production." },
+          "catalogResetEndpoint": { "type": "string", "description": "Optional path (e.g. /v1/packs-test/reset) that clears the test catalog. When advertised, suite teardown SHOULD call it." },
+          "scopes": { "type": "array", "items": { "type": "string", "enum": ["core","vendor","community","private","local"] }, "description": "Which namespace scopes the test catalog accepts. Public test catalogs SHOULD refuse `private` and `local`; private dev catalogs MAY accept all five." }
+        },
+        "required": ["supported"],
+        "additionalProperties": false
+      }
     }
   }
```

### §B New endpoints

```yaml
paths:
  /v1/packs-test/{name}/-/{version}.tgz:
    put:
      operationId: putTestPackTarball
      tags: [packs-test]
      description: |
        Mirror of /v1/packs/{name}/-/{version}.tgz against the
        isolated test catalog. Same request/response shape +
        error-code catalog as the production endpoint.
    get:
      operationId: getTestPackTarball
      tags: [packs-test]
    delete:
      operationId: deleteTestPackVersion
      tags: [packs-test]
      description: Mirror of unpublish-window semantics.
  /v1/packs-test/{name}/-/{version}.sig:
    get:
      operationId: getTestPackSignature
      tags: [packs-test]
```

All endpoints surface the documented 19 error codes verbatim. Path semantics, status codes, error envelope shape MUST match the production `/v1/packs/*` surface so conformance scenarios written against the test namespace prove the production-namespace contract.

### §C Isolation guarantees

A host advertising `packs.testMode.supported: true` MUST:

1. Persist every test-namespace pack to a catalog distinct from the production catalog. A pack PUT'd to `/v1/packs-test/core.openwop.x@1.0.0` MUST NOT appear in `/v1/packs/core.openwop.x`'s catalog listing.
2. Refuse `/v1/packs-test/*` traffic when `OPENWOP_TEST_SEAM_ENABLED` is unset (matches the existing test-seam env-gating pattern). The boot log SHOULD warn when the surface is exposed.
3. NOT serve the test-namespace catalog from the host's public-discovery (`packs.openwop.dev`) endpoints. Test-catalog packs MUST NOT appear in production registry listings.
4. Honor `catalogResetEndpoint` when advertised — calling it MUST clear the entire test catalog (suite teardown).

### §D Conformance scope

The 26 scenarios in `pack-registry-publish.test.ts` are all `it.todo()` today. This RFC converts them to behavioral assertions that:

- Soft-skip when `capabilities.packs.testMode.supported !== true`
- Use `/v1/packs-test/*` instead of `/v1/packs/*` for every assertion
- Verify the spec-documented error code AND HTTP status (4xx range)

The 19-code catalog covered:

| Category | Codes |
|---|---|
| URL / scope (§A point 1) | `invalid_pack_scope`, `invalid_pack_name`, `invalid_version` |
| Body shape (§A point 2) | `invalid_body` |
| Tarball extraction | `tarball_gunzip_failed`, `tarball_too_large`, `tarball_manifest_missing`, `tarball_manifest_too_large`, `tarball_manifest_not_json`, `tarball_entry_missing`, `tarball_entry_too_large`, `tarball_path_traversal`, `tarball_tar_parse_failed` |
| Manifest contents | `invalid_manifest`, `manifest_mismatch` (or pair: `manifest_name_mismatch` / `manifest_version_mismatch`), `pack_integrity_failure`, `unsupported_runtime` |
| Auth + conflict | `forbidden` (403), `conflict` (409, or `version_conflict`), idempotent re-publish (200) |
| Unpublish | `unpublish_window_expired` |
| Signature pairing | `signature_not_available` (404 after PUT-without-sig and after YANK) |

## Compatibility

**Additive** per `COMPATIBILITY.md §2.1`.

- New optional capability block (`packs.testMode`); old hosts ignore.
- New namespace (`/v1/packs-test/*`); production namespace (`/v1/packs/*`) is unchanged.
- No new required fields in any existing schema.
- No event-type shape changes.
- No existing MUST relaxed.

## Conformance

- 26 existing `it.todo()` scenarios in `pack-registry-publish.test.ts` convert to behavioral assertions against `/v1/packs-test/*`. Each soft-skips when the host doesn't advertise `packs.testMode.supported: true`.
- A new `pack-registry-isolation.test.ts` scenario (added in the impl PR, not this RFC) verifies that a pack PUT'd via test namespace does NOT appear in production-namespace listings — anchors the isolation invariant.

## Alternatives considered

1. **Super-admin scope for the conformance suite.** Rejected — gives the suite the power to mutate the real catalog. Non-starter for any registry shared across operators.
2. **Mock the error catalog at the SDK level.** Rejected — would assert SDK error-mapping rather than host implementation. Misses cross-host divergence (the load-bearing problem).
3. **Embed the test catalog inside the production namespace via a magic name prefix (e.g. `test.*`).** Rejected — magic prefixes leak into discovery listings and confuse third-party clients. A separate namespace is cleaner.
4. **Do nothing.** Rejected — leaves 26 conformance scenarios as documentation-only `it.todo()` forever. The error catalog stays untested across hosts; divergence ships silently.

## Unresolved questions

1. Should `catalogResetEndpoint` be REQUIRED for `packs.testMode.supported: true`? Cleaner suite teardown, but raises the implementation bar.
2. Should the test namespace accept the `private.*` and `local.*` scopes (which the production namespace refuses for public registries)? Current proposal: yes for private dev catalogs (via `packs.testMode.scopes`), no for public test catalogs.
3. Should there be a TTL on test-catalog entries (auto-cleared after N hours)? Useful for shared CI environments; complicates simple in-memory impls. Defer to v1.2.

## Implementation notes (non-normative)

- Reference impl candidate: `apps/workflow-engine/backend/typescript/src/routes/packs-test.ts` — in-memory isolated catalog; env-gated on `OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true`.
- All 19 error codes can be unit-tested via a single validation pipeline that runs checks in order; first-failing-check wins. Mirrors the production publish handler's check order.
- The signature-endpoint pairing tests assume the host serves `.sig` from the same backing store as the tarball; impl SHOULD use a single record per (name, version) with optional `signature` blob field.

## Acceptance criteria

- [ ] RFC 0025 follows the template; 7-day comment window expires 2026-05-26
- [ ] `capabilities.packs.testMode` block added to `schemas/capabilities.schema.json`
- [ ] `spec/v1/node-packs.md` gains §"Test-mode registry namespace" referencing this RFC
- [ ] `api/openapi.yaml` declares the 4 new endpoints with all 19 error responses
- [ ] Reference impl at `apps/workflow-engine/.../routes/packs-test.ts` (in-memory)
- [ ] 26 scenarios in `pack-registry-publish.test.ts` converted to behavioral (each soft-skips when the seam isn't advertised)
- [ ] `npm run openwop:check` 9/9 green
- [ ] CHANGELOG entry under `[Unreleased]`

## References

- `spec/v1/node-packs.md` §"PUT /v1/packs/{name}/-/{version}.tgz" — production endpoint that this mirrors
- `auth.md` §"`packs:publish` scope" — the scope required for production publishing
- `host-extensions.md` §"Canonical prefixes" — the sample-namespace convention
- `conformance/src/scenarios/pack-registry-publish.test.ts` — the 26 deferred scenarios this RFC unblocks
