# `@openwop/openwop-conformance` Changelog

## [1.0.0] — 2026-05-10

Reset to the OpenWOP v1.0 production-release baseline.

### What's covered

- Server-free spec-corpus validation across JSON Schemas, OpenAPI, AsyncAPI, REST endpoint docs, fixture docs, SDK helper surfaces, and TypeScript publish artifacts.
- Black-box scenarios for discovery, workflow listing, run lifecycle, events, interrupts, cancellation, replay/fork behavior, idempotency, concurrency, malicious manifests, and route coverage.
- Packaged API contracts (`api/`, `schemas/`, fixtures, and coverage docs) so installed conformance runs do not depend on a repository checkout.
- Production metadata gates for package names, licenses, repository URLs, stale import paths, and v1.0 release posture.

### v1.x additions

- Reference deployment compatibility matrix automation.
- Optional server-required scenario bundles for deployment-specific auth and credential profile checks.
