# Contributing to OpenWOP v1

Thanks for considering a contribution. The OpenWOP v1.0 spec is small, mechanical, and intentionally focused — small PRs land fastest.

This guide covers:

1. What's in scope.
2. Status legend + when to bump status.
3. Per-artifact change rules (prose specs, JSON Schemas, OpenAPI, AsyncAPI, conformance, SDK).
4. The CI gate.
5. Coordination with the impl plan.

---

## What's in scope

The openwop v1 corpus describes the **wire-level contract** between independent implementations of workflow orchestration servers and the clients that talk to them. It does NOT prescribe:

- Internal data structures (Zustand vs Redux vs raw classes — implementer's call).
- Storage backends (Firestore vs Postgres vs SQLite — implementer's call).
- How LLM prompts are constructed (implementer's call, modulo the `Capabilities` handshake).
- UI conventions (any UI is fine — the spec only defines the wire data).

When a PR proposes adding to one of those surfaces, expect pushback: it likely belongs in an implementation's docs, not the spec.

---

## Status legend

Per `auth.md` §status legend (and reflected in every prose doc's header):

| Tag         | Meaning                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| **STUB**    | Minimal coverage of stable surfaces only. Implementers SHOULD pin only to what's documented; gaps are expected. |
| **DRAFT**   | Comprehensive coverage of stable + in-flight surfaces, but not yet reviewed by spec committee.                  |
| **OUTLINE** | Sketched but not detailed. Section headings lock; field schemas may shift.                                      |
| **FINAL**   | Reviewed + frozen for a given v1.X release. Breaking changes require a major bump.                              |

When to bump status:

- **STUB → DRAFT**: when every stable wire-level field is documented (RFC 2119 keywords applied, examples present, edge cases called out).
- **DRAFT → OUTLINE**: backward — only when a section needs more design work than originally thought.
- **DRAFT → FINAL**: after committee review (none formally chartered yet — see "Process" below).

---

## Per-artifact change rules

### Prose specs (`*.md`)

- Every doc MUST include a header status block with: status tag, draft date, and a "stable surface for external review" note.
- Use RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT) consistently.
- Cross-reference companion specs by relative path. From the repo root, use links like `[capabilities.md](./spec/v1/capabilities.md)`; from inside `spec/v1`, link to peer docs by filename.
- New surface area: add a "Why this exists" paragraph + an "Open spec gaps" table at the end.

### JSON Schemas (`schemas/*.schema.json`)

- Every schema declares `$schema: "https://json-schema.org/draft/2020-12/schema"`.
- Every schema has a `$id` that's a URL under `https://openwop.dev/spec/v1/<name>.schema.json`.
- Use `additionalProperties: false` on every object — explicit field lists are mandatory for spec docs even if a runtime relaxes them.
- New required fields: bump the schema's implicit minor version + update CHANGELOG.md. New optional fields are non-breaking.

### Pack-internal JSON Schemas (`packs/<name>/schemas/*.schema.json`)

> **Moved:** the pack ecosystem (`packs/` source + the `registry/` catalog) now lives in [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry). Pack contributions, the rules below, and the pack/registry validation gate (`scripts/registry-check.sh`) apply in that repo. The pack-manifest _schemas_ remain normative here under `schemas/` (vendored into the registry repo with a drift guard).

Distinct from the spec-corpus schemas above. These live inside a pack's tarball and are referenced via `pack.json` (`configSchemaRef` / `inputSchemaRef` / `outputSchemaRef` for nodes; `handoff.{task,return}SchemaRef` for agent manifests per RFC 0003 §D). Rules:

- `$schema: "https://json-schema.org/draft/2020-12/schema"` — same as spec corpus.
- `$id` MUST use the **registry-canonical, version-bearing** form: `https://packs.openwop.dev/<pack-name>/<version>/<file-name>.schema.json`. The version segment MUST match `pack.json.version`. This keeps `$id` immutable across pack version bumps — caching tools that key on `$id` see distinct documents per pack version (per JSON Schema 2020-12 `$id` immutability semantics).
- `additionalProperties: false` on every object — same discipline as spec corpus.
- Pack `version` bump: regenerate every `$id` in the pack's `schemas/` directory to the new version. `scripts/precheck-packs.mjs` SHOULD catch drift; pack authors MAY also wire a regen step into their release script.

### OpenAPI / AsyncAPI

- Reference JSON Schemas via cross-file `$ref` (`../schemas/<name>.schema.json`); never inline.
- Lint must pass: `redocly lint api/openapi.yaml` and `asyncapi validate api/asyncapi.yaml` from `@asyncapi/cli`.
- Bundle must succeed: `redocly bundle api/openapi.yaml` and `asyncapi bundle api/asyncapi.yaml`.
- New endpoints: add a `tag`, an `operationId`, request/response schemas, and at least one error response.

### Conformance suite (`conformance/`)

- Each new scenario file in `conformance/src/scenarios/` follows the existing pattern:
  - Top-of-file docstring stating the spec doc(s) being verified.
  - `describe('category: …', …)` blocks per assertion group.
  - `expect(…, driver.describe('spec.md §section', 'requirement'))` so failure messages cite the requirement.
- New fixtures go in `conformance/fixtures/` AND must be added to `fixtures.md`'s catalog table + per-fixture contracts. The `spec-corpus-validity.test.ts` round-trip test will fail otherwise.
- Server-free scenarios (those not requiring `OPENWOP_BASE_URL`) MUST run in <1s. CI gates on this.

### TypeScript reference SDK (`sdk/typescript/`)

- Every endpoint in `api/openapi.yaml` should map to ONE method on `OpenwopClient`. If you add an endpoint to the spec, add the corresponding SDK method in the same PR.
- Types come from the spec — extend `src/types.ts` rather than redefining shapes inline.
- `tsc --noEmit` must pass with `strict + exactOptionalPropertyTypes`. No `as any`, no `@ts-ignore`.
- Zero runtime dependencies remains a goal. New deps need a stated reason in the PR description.

### Reference applications (`apps/`)

A separate tier from `examples/` (single-file demos) and `examples/hosts/` (conformance-test targets). Each `apps/<sample>/` is a deployable template — backend + frontend + Dockerfile + auth + storage + observability wired together.

Conventions when contributing a new sample (or a new BE/FE under an existing one):

- **Layout.** Backends live under `apps/<sample>/backend/<language>/`; frontends under `apps/<sample>/frontend/<framework>/`. Mirror an existing sample's structure.
- **Boundary discipline.** Anything sample-specific (stub auth, demo packs, local workflows) MUST live under `local.*` or `sample.*` namespaces — never under `core.*`, `openwop.*`, or `vendor.<org>.*`. The `host-extensions.md` namespace rule applies inside `apps/` exactly as it does in production hosts.
- **Honest discovery.** The `/.well-known/openwop` advertisement MUST reflect what the sample actually implements. Do not claim profiles or capabilities that are stubbed — downgrade the advertisement instead.
- **Banned patterns.** No `as any`, `@ts-ignore`, or `@ts-nocheck` in `apps/<sample>/<lane>/<language>/src/`. Production-grade hygiene applies even though samples are non-normative — the sample teaches by example.
- **Dependencies.** Sample dependencies are local to the sample; root `npm install` and the spec corpus are unaffected. New deps need a one-line justification in the PR.
- **CI.** Sample CI runs in its own workflow step. A sample failure does NOT block a spec release; the gate stays scoped to spec/SDK/conformance/security.
- **Public docs.** Mention the sample in the root `README.md` "Reference applications" section + add a `[Unreleased]` line in `CHANGELOG.md`. Do NOT introduce deployment-target language ("Cloud Run", "AWS Lambda", "Fly.io") into `README.md` / `QUICKSTART.md` — `spec-corpus-validity.test.ts` enforces neutrality there. The sample's own README is the place for deployment specifics.
- **Documentation.** Each `apps/<sample>/` has a `README.md` (run instructions + honest pass-matrix) and `ARCHITECTURE.md` (component map + boundary discipline). The latter cites where each spec requirement is implemented in the sample.

---

## The CI gate

A openwop-spec PR is mergeable when:

1. `redocly lint api/openapi.yaml` — clean.
2. `asyncapi validate api/asyncapi.yaml` — clean.
3. Every JSON Schema compiles via Ajv2020 (covered by `conformance/src/scenarios/spec-corpus-validity.test.ts`).
4. Every fixture validates against `workflow-definition.schema.json` (covered by `conformance/src/scenarios/fixtures-valid.test.ts`).
5. Every prose doc carries a `Status:` legend tag (covered by `spec-corpus-validity.test.ts`).
6. The TS SDK builds clean (`cd sdk/typescript && tsc --noEmit`).
7. The `openwop-conformance --offline` server-free subset passes.
8. `CHANGELOG.md` updated when changing any artifact (1-line entry under `[Unreleased]` is fine).
9. Per-SDK lint passes for any SDK directory the PR touches (per `.github/workflows/pr-checks.yml`):
   - **TypeScript** — ESLint via the SDK's existing config.
   - **Python** — `ruff check sdk/python/`.
   - **Go** — `go vet ./...` and `gofmt -l .` produces no output.
10. Every commit on the PR carries a `Signed-off-by:` trailer per the DCO (see §"Sign your commits" below).

Run the full local check from the repo root:

```bash
npm run openwop:check
```

Equivalent direct script:

```bash
bash scripts/openwop-check.sh
```

### Optional pre-commit guard

Install once per clone to catch the most common author-side slip
(staging an RFC change without regenerating `docs/PROTOCOL-STATUS.md`
and `README.md`):

```bash
bash scripts/install-git-hooks.sh
```

This symlinks `scripts/hooks/pre-commit` into `.git/hooks/`. The
hook is fast (<1s) and only fires when staged paths match
`RFCS/*.md`. Heavier validation stays in CI.

---

## Coordination with the impl plan

When a spec PR proposes a change that interacts with a reference implementation:

- **Cosmetic / additive** (new field, new event type as opt-in, new endpoint): merge spec PR independently. Impl will catch up.
- **Breaking impl assumptions** (schema bump on existing event, new required field, removed field): coordinate via `WORKFLOW-PROTOCOL-openwop-PLAN.md` "Cross-cuts to impl plan" section. Add a `CC-N` entry. The impl plan owner approves before merge.

Cross-cuts currently tracked: CC-1 (recursionLimit invariant — partial), CC-2 (typed channels — deferred), CC-3 (OTel taxonomy — done), CC-4 (maxNodeExecutions — done).

---

## Process

The openwop spec doesn't yet have a formal committee. Until one exists:

- **PRs**: opened against the implementation repo, labeled `openwop-spec`. Merge bar is "two reviewers from different organizations" once the spec leaves DRAFT.
- **Issues**: see `README.md` §Reporting issues — include doc filename, section heading, RFC 2119 requirement that's unclear or contradictory, and implementation impact.
- **Backwards compat**: until v1 FINAL, breaking changes are allowed but MUST come with a CHANGELOG entry + a runbook section in `version-negotiation.md` describing migration.

---

## Sign your commits (DCO)

Every commit on a pull request MUST carry a `Signed-off-by:` trailer. This is the [Developer Certificate of Origin](https://developercertificate.org/) — the lightweight alternative to a CLA. By signing off, you assert you have the right to submit the work under the project's license (Apache-2.0 for code, CC-BY-4.0 for spec text).

How to sign:

```bash
git commit -s -m "your message"             # adds Signed-off-by automatically
git commit --amend -s --no-edit             # add to an existing commit
git rebase --signoff -i HEAD~3              # add to the last 3 commits
```

The DCO check is wired through the [DCO bot](https://github.com/dcoapp/app); it runs on every PR and blocks merge until every commit is signed off. A failing DCO check is the only "fix-forward" the maintainer set explicitly allows: amend + force-push and we'll re-run.

**Bootstrap-phase reality (until `MAINTAINERS.md` lists a non-steward maintainer):** the steward currently lands commits directly on `main` without a PR gate, so the DCO bot does not run on those commits in practice. Commits authored in bootstrap phase have shipped with `Co-Authored-By:` trailers (for AI-assistant attribution) but without `Signed-off-by:`. This is a documented drift between the stated rule and current practice. The MUST above becomes operationally enforceable once the PR-based workflow re-engages — i.e., as soon as a non-steward maintainer joins per the `ROADMAP.md` migration tripwire. Until then, contributors submitting PRs SHOULD sign their commits; the steward's direct-to-`main` commits are exempt by practice but the exemption is recorded here for transparency.

---

## Triage SLA

A maintainer will respond to your PR or issue within:

- **24 hours** for security-flagged issues (per `SECURITY.md`).
- **7 calendar days** for everything else.

"Respond" means substantive: a review, a redirect, or a "I'll get to this by ~date." Silence past 7 days means the maintainer rotation isn't keeping up; ping `@davidscotttufts` directly.

If your PR sits past 14 days without a substantive response, that's a maintainer-set capacity problem, not a quality problem with your contribution. We document this honestly so contributors can decide whether to wait.

---

## Bootstrap-phase notes (2026-05-05)

Until `MAINTAINERS.md` lists at least one maintainer not affiliated with the original steward (per the `ROADMAP.md` migration tripwire), the following bootstrap-phase rules apply:

- **One-approval review.** Branch-protection on `main` requires one maintainer approval. Post-bootstrap (when MAINTAINERS.md grows past one), this becomes two approvals from different organizations per `GOVERNANCE.md` §"Decision making."
- **Conformance scenario authorship.** PRs touching `conformance/src/scenarios/` or `conformance/src/lib/` route through `CODEOWNERS` to the lead maintainer. Same elevation post-bootstrap (cross-org reviewers required).
- **Spec corpus changes.** Same elevation logic — `CODEOWNERS` routes `/spec/v1/`, `/api/`, `/schemas/` to the lead maintainer; cross-org review post-bootstrap.
- **DCO `Signed-off-by:` exemption.** The steward's direct-to-`main` commits ship without `Signed-off-by:` trailers in practice (see §"Sign your commits (DCO)" above). External contributors submitting PRs MUST still sign every commit. The exemption ends when the PR-based workflow re-engages with the first non-steward maintainer.
- **`bash scripts/openwop-check.sh` before push.** The 8-step gate is fast (~30s warm cache) and surfaces fixture-catalog drift, schema discipline breaks, and conformance-validity issues before they hit `origin/main`. Run it before every push to avoid red gates on `main` that block other contributors.
- **RFC comment-window waivers.** Additive RFCs (7-day window) MAY be promoted Draft → Active by steward decision when the comment window would only serve as a delay against zero external reviewers. Each waived RFC MUST record the waiver in its `Updated` field. RFCs 0009 and 0010 are the worked examples — see `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" for the running list.

The bootstrap-phase amendment is filed as RFC 0005 in the `RFCS/` directory.

---

## Useful one-liners

```bash
# Validate every schema compiles + fixtures + spec corpus, all server-free
conformance/dist/cli.js --offline

# Lint OpenAPI
npx -y @redocly/cli@latest lint api/openapi.yaml

# Validate AsyncAPI
npx -y @asyncapi/cli@latest validate api/asyncapi.yaml

# Build TS SDK
(cd sdk/typescript && npm install && npm run build)

# Find every prose doc that's still STUB-tier (candidates for promotion)
grep -l "Status:.*STUB" *.md
```
