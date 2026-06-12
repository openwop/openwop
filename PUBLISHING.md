# OpenWOP Spec v1 — Publishing Plan

> **⚠️ Repo split (2026-06):** the three SDKs (TypeScript `@openwop/openwop`, Python `openwop-client`, Go) moved to **[`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks)** and publish from there; the pack registry moved to **[`openwop/openwop-registry`](https://github.com/openwop/openwop-registry)**; reference hosts + examples to **[`openwop/openwop-examples`](https://github.com/openwop/openwop-examples)**; the CLI already lives in **[`openwop/openwop-cli`](https://github.com/openwop/openwop-cli)**. **This repo now publishes exactly one artifact: `@openwop/openwop-conformance`** (`conformance/`). The SDK release process below is retained for reference but is executed from `openwop-sdks`. **Versioning alignment still holds across repos:** the SDKs track the spec major — a coordinated spec release (`v*` here) MUST be matched by SDK release tags pushed in `openwop-sdks`.

> **Status: FINAL v1.0 release plan (2026-05-10).** Operational plan for publishing the spec-corpus artifacts to their respective registries. Every publishable artifact MUST carry v1.0 metadata until the first v1.x maintenance release.

---

## Why this exists

The spec corpus ships 4 distributable artifacts alongside the prose docs, plus 1 independently-versioned operator tool:

| Artifact                     | Package name                        | Version  | Registry                      | Status                                                                                                                                 |
| ---------------------------- | ----------------------------------- | -------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript SDK               | `@openwop/openwop`                  | `1.0.0`  | npm                           | **Ready for v1.0 publish**                                                                                                             |
| TypeScript conformance suite | `@openwop/openwop-conformance`      | `1.0.0`  | npm                           | **Ready for v1.0 publish**                                                                                                             |
| Python SDK                   | `openwop-client`                    | `1.0.0`  | PyPI                          | **Ready for v1.0 publish**                                                                                                             |
| Go SDK                       | `github.com/openwop/openwop-sdks/go` (was `…/openwop/sdk/go`, frozen at its last in-corpus tag) | `v1.0.0` | Go modules (proxy.golang.org) | **Ready for v1.0 tag** (from `openwop-sdks`)                                                                                           |
| OpenWOP CLI                  | `@openwop/cli`                      | —        | npm                           | **Moved** — now lives in [`openwop/openwop-cli`](https://github.com/openwop/openwop-cli) and publishes from there (not from this repo) |

The four spec-corpus artifacts should ship from the same v1.0 baseline. Historical point-in-time package versions from before the OpenWOP reset are intentionally ignored; this document is the source of truth for the OpenWOP v1.0 production release.

The CLI is operator-side tooling (not part of the v1 wire surface). It was extracted from this monorepo into [`openwop/openwop-cli`](https://github.com/openwop/openwop-cli), where it carries its own `0.x` SemVer line and publishes on its own `vX.Y.Z` tags via that repo's `publish.yml`. It is no longer built, tested, or released from this corpus repo, and a corpus-aligned `v*` tag no longer touches it.

---

## Publication policy

### What gets published when

| Trigger                                     | Action                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Spec patch release (e.g., 1.0.0 → 1.0.1)    | All 4 artifacts re-publish at the patch version.                                                                                  |
| Spec minor release (e.g., 1.0.x → 1.1.0)    | All 4 artifacts re-publish at a new minor (or patch, if changes are SDK-internal).                                                |
| Spec major release (e.g., 1.x → 2.0)        | All 4 artifacts re-publish at a new major. Old major remains accessible (npm tags, PyPI versions, Go module paths) for 12 months. |
| SDK-only patch (e.g., bug fix in TS client) | Only the affected SDK re-publishes; spec corpus version unchanged.                                                                |
| Conformance scenario addition               | `@openwop/openwop-conformance` minor bump; other artifacts unaffected.                                                            |

### Versioning alignment

- The 3 SDKs (`@openwop/openwop`, `openwop-client`, `openwopclient`) MUST track the spec major. A spec at v1.x always has SDKs at v1.x. Within a major, SDK patch versions float independently.
- `@openwop/openwop-conformance` starts at `1.0.0` for the v1.0 release. After v1.0, it may independently bump minors when scenarios are added/removed. Patch versions track bug fixes in scenario assertions.
- Go module path includes the major (`/v1`) per Go convention. The v1 path is `github.com/openwop/openwop/sdk/go`; v2 will be `github.com/openwop/openwop/sdk/go/v2`.

### Deprecation policy

A published version is deprecated when:

- A bug or security issue affects a specific version → npm `deprecate` / PyPI `yank` / Go module retraction.
- A new minor supersedes the version with backward-compat → optional deprecation, prefer next-version messaging in the changelog.

Critical security advisories follow the standard CVE flow plus an entry in this repository's security advisory log.

---

## Pre-publish checklist

Run before EVERY publish (manual or CI-driven). The checklist is a hard gate; one item failing means the release doesn't go.

### All artifacts

- [ ] `npm run openwop:check` passes locally — spec corpus is internally consistent.
- [ ] **Known follow-up:** pin Redocly + AsyncAPI CLI versions in root release tooling once a Node-compatible pair is selected. Current gate uses `npx` with a writable temp cache; pinning `@redocly/cli@2.30.4` and `@asyncapi/cli@6.0.0` was paused because exact-version `npx -p` resolution hung locally and `@asyncapi/cli@6.0.0` warns that it prefers Node 24.
- [ ] CHANGELOG entry exists at the canonical doc (e.g., `CHANGELOG.md` for spec releases; per-package CHANGELOG for SDK-only patches).
- [ ] Version field in the package manifest matches the git tag.
- [ ] License is `Apache-2.0` and `LICENSE` file is present in the published artifact.
- [ ] No scaffold, unpublished, legacy planning, or stale historical live-version language in package descriptions.
- [ ] **`ROADMAP.md` re-validated against the new release.** If any "Pending" row in the v1.X minor table or capability-profile table is now closed by the scenario set in this release, flip its status in the same PR. Bump the `Last reviewed:` line in the header. The roadmap silently drifting from the suite version is the failure mode this gate exists to catch.

### `@openwop/openwop` (npm)

- [ ] `cd sdk/typescript && npm run typecheck` clean.
- [ ] `cd sdk/typescript && npm run build` produces `dist/` cleanly.
- [ ] `npm_config_cache=/private/tmp/openwop-npm-cache npm pack --dry-run` shows ONLY `dist/`, non-test `src/`, `README.md`, `package.json`, `LICENSE`. No tests, no node_modules, no .DS_Store.
- [ ] `package.json` `private` field is removed (or set to `false`) — `private: true` blocks publish.
- [ ] `package.json` `repository` field points at a public source location.

### `@openwop/openwop-conformance` (npm)

- [ ] `cd conformance && npm run test` passes (server-free subset MUST pass; server-required scenarios MAY skip if no reference deployment is reachable).
- [ ] `cd conformance && npm run build:cli` produces `dist/cli.js` cleanly + the bin field resolves.
- [ ] `npx openwop-conformance --help` works after a fresh install in a temp directory.
- [ ] `package.json` `private` field removed.

### `openwop-client` (PyPI)

- [ ] `cd sdk/python && python -m hatchling build` produces `dist/*.whl` + `dist/*.tar.gz`.
- [ ] `python -m twine check dist/*` passes.
- [ ] Smoke test: `pip install dist/*.whl` in a fresh venv, `python -c "import openwop_client; print(openwop_client.__version__)"` works.
- [ ] `pyproject.toml` description doesn't mention "Scaffold".
- [ ] PyPI classifier `Development Status :: 5 - Production/Stable`.

### `openwopclient` (Go modules)

- [ ] `cd sdk/go && go vet ./...` clean (in `openwop-sdks`).
- [ ] `cd sdk/go && go test ./...` passes (in `openwop-sdks`).
- [ ] `go.mod` declares `go 1.22+` and module path `github.com/openwop/openwop-sdks/go` (no `/v1` suffix at v1.x.x; only v2+ uses the suffix). The pre-split `github.com/openwop/openwop/sdk/go` path is frozen at its last in-corpus tag.
- [ ] Tag `openwop-sdks` with the subdirectory prefix matching the module's path within that repo — Go requires it for non-root modules. (A bare `v1.0.0` at the repo root WON'T work for a sub-module.)
- [ ] Verify discoverability: `curl -sI https://proxy.golang.org/github.com/openwop/openwop-sdks/go/@v/v1.0.0.info` returns 200 after tag push (cache warm-up ~5 min).

---

## Release manager

The spec working group designates a release manager per release cycle. The role:

- Runs the pre-publish checklist.
- Publishes the artifacts (or triggers the CI workflow that does).
- Posts a release note in the spec-corpus repo's release feed.

For v1 launch, the release manager is the spec working group lead recorded in `MAINTAINERS.md`. For v1.x maintenance releases, the role rotates among working group members.

---

## CI automation

Publish workflow at `.github/workflows/openwop-publish.yml`. Triggers map 1:1 to the §"Publication policy" release-type matrix above:

| Tag pattern                                                  | Triggers                   | Use case                                                                                                  |
| ------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `v*` (e.g. `v1.0.0`)                                         | all 4 publish jobs         | Spec corpus release — patch / minor / major. Every artifact bumps to the same version.                    |
| `openwop/v*` (e.g. `openwop/v1.0.1`)                         | `publish-ts-client` only   | TS SDK bug fix; spec + conformance + Python + Go versions unchanged.                                      |
| `openwop-conformance/v*` (e.g. `openwop-conformance/v1.0.1`) | `publish-conformance` only | Conformance scenario addition or test-suite bug fix.                                                      |
| `openwop-client/v*` (e.g. `openwop-client/v1.0.1`)           | `publish-python` only      | Python SDK bug fix.                                                                                       |
| `sdk/go/v*` (e.g. `sdk/go/v1.0.0`)                           | `publish-go` only          | Go SDK bug fix. **Doubles as the subdir-prefix tag** that proxy.golang.org requires for non-root modules. |

Push the most specific tag for the change. Per-package tags keep unrelated packages at their current version (no phantom no-op republishes). Post-split, only the `v*` (corpus) and `openwop-conformance/v*` patterns fire from this repo; the three SDK tag patterns are executed in `openwop-sdks` (its publish workflow keeps the same per-package shape).

Each publish job is **idempotent**: before publishing, it checks whether the package's manifest version is already on its registry (`npm view <pkg>@<version>` for the three npm packages; `skip-existing: true` for the PyPI upload) and **skips rather than fails** if so. This means a corpus-aligned `v*` tag — which fires every publish job — can never partial-publish or hard-fail when some packages are already at their version (e.g. shipped earlier via their per-package tag); only the genuinely-fresh packages publish. The guard makes re-running a tag safe and makes a corpus tag tolerant of the common "only one package changed" case, but it does **not** change the policy above: push the most specific tag, and reserve a `v*` corpus tag for a genuine coordinated multi-artifact delta.

The workflow runs `bash scripts/openwop-check.sh` as a hard preflight before any publish job, so a bad commit can't reach the registries even if a tag is pushed.

Secrets required (configured once at repo settings):

- `NPM_TOKEN` — npm automation token with publish scope on `@openwop` (used for `@openwop/openwop` and `@openwop/openwop-conformance`).
- `PYPI_TOKEN` — PyPI API token (project-scoped to `openwop-client` recommended after first publish).
- Go publication needs no secret — Go modules consume tags directly from the public repo.

Activation checklist:

1. [ ] npm scope: `@openwop` available to the release manager.
2. [ ] PyPI project: `openwop-client` available to the release manager.
3. [ ] Go module path: `github.com/openwop/openwop-sdks/go` verified from the public `openwop-sdks` repo (the pre-split `…/openwop/sdk/go` path is frozen at its last in-corpus tag).
4. [ ] `NPM_TOKEN` + `PYPI_TOKEN` configured in repo settings, or local manual publish credentials prepared.
5. [ ] Workflow active at `.github/workflows/openwop-publish.yml`, if using CI publish.
6. [ ] Initial OpenWOP release tags planned: `v1.0.0` for corpus-aligned artifacts here, and the Go submodule's subdir-prefix tag in `openwop-sdks`.
7. [ ] Registry pages verified after publication.

For each subsequent release:

- **Corpus-aligned** (e.g. spec patch 1.0.0 → 1.0.1): push `vX.Y.Z`. All 4 jobs run.
- **Per-package** (e.g. conformance 1.0.0 → 1.0.1): push the matching per-package tag from the matrix above. Only the matching job runs.

Always: bump the version in the corresponding `package.json` / `pyproject.toml` BEFORE pushing the tag, and run `bash scripts/openwop-check.sh` locally to surface any pre-publish issues that the workflow's preflight would catch.

### Post-publish SDK bump (downstream repos)

After `openwop-publish.yml/publish-ts-client` publishes a new `@openwop/openwop`, downstream consumers bump their own pin in their own repos — most notably **[`openwop/openwop-app`](https://github.com/openwop/openwop-app)** (the reference app's Cloud Run backend + Firebase frontend bundle, extracted from this monorepo). The in-repo auto-bump workflow that previously updated `apps/workflow-engine/*` was removed with the app; that bump now lives with the app.

**One-time repo setup** (only needed before the first auto-PR): in _Settings → Actions → General → Workflow permissions_, enable **"Allow GitHub Actions to create and approve pull requests"**. Without this, the bot's `gh pr create` call returns 403 and the workflow logs a clear error.

Why this exists: every TS SDK release historically required a manual lockfile-bump step before the demo Cloud Run + Firebase Hosting deploys could pull the new SDK. Cloud Run's `npm ci` runs in lockfile-isolated mode, so an outdated lockfile silently pinned the old SDK even when npm carried a newer one. The 2026-05-21 1.1.2 → 1.1.3 release burned three Cloud Run revisions before the manual bump caught up; this workflow closes that loop.

---

## `@openwop/protocol` decision

**Decision (2026-04-29): not publishing as a separate package.**

The question was whether the wire-format types (`Capabilities`, `RunSnapshot`, `RunEventDoc`, etc.) should ship as a standalone `@openwop/protocol` npm package alongside the SDKs.

The decision is to skip:

- **The schemas are already the canonical contract.** `api/openapi.yaml` (OpenAPI 3.1) and `schemas/*.json` (JSON Schemas) ARE the wire format. Each SDK hand-mirrors them in its own `types.{ts,py,go}` for ergonomics; the schemas remain authoritative.
- **A standalone TS types package would create a second source of truth.** It could drift from the canonical schemas and from the per-SDK mirrors. Less surface area to keep aligned.
- **Non-TS consumers don't benefit.** Python and Go consumers already hand-mirror in their language; extracting TS types in a separate package doesn't help them.
- **Per Guiding Rule #2** of the phased plan ("treat the PRD §6.1 package list as capability domains, not npm packages"), the bar to extract is a concrete external consumer with a concrete reason. None exists today.

If a third-party tool later needs codegen-friendly types (e.g., a TS code generator that wants to import them without the runtime), the path is:

1. Verify the JSON Schemas alone aren't sufficient (they usually are — `json-schema-to-typescript` etc.).
2. If they aren't, extract `@openwop/protocol` at that point — type-only, compiled from the JSON Schemas at build time, no hand-mirroring.

Until then, types ship as part of `@openwop/openwop` and consumers can tree-shake the runtime if they only want types.

---

## In-repo-only artifacts (no plan to publish)

Some artifacts in the spec corpus are documentation-only and explicitly NOT for public registry publication:

- The prose spec docs (`auth.md`, `rest-endpoints.md`, etc.) — distributed via the repo's docs site.
- The JSON Schemas (`schemas/*.json`) — referenced by URL from the published artifacts; the spec-corpus repo IS the authoritative source.
- The conformance fixtures (`conformance/fixtures/`) — pulled into `@openwop/openwop-conformance` at build time.
- The OpenAPI + AsyncAPI YAMLs — referenced by URL.

These artifacts are hosted from the public repository and generated docs site; package-release workflows do not republish them to registries.

---

## See also

- `README.md` — spec corpus index.
- `CONTRIBUTING.md` — governance + contribution process.
- npm publishing docs: <https://docs.npmjs.com/cli/v10/commands/npm-publish>
- PyPI publishing docs: <https://packaging.python.org/en/latest/tutorials/packaging-projects/>
- Go modules: <https://go.dev/ref/mod>
