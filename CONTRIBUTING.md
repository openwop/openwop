# Contributing to OpenWOP

Thanks for considering a contribution. Small, focused pull requests land fastest.

This guide covers:

1. What's in scope.
2. Status labels.
3. Change rules per artifact (prose, JSON Schemas, OpenAPI/AsyncAPI, conformance).
4. Regenerating derived files and running the gate.
5. Process, DCO sign-off and response times.

Other code lives in sibling repositories:

- SDKs: [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks).
- Example and reference hosts: [`openwop/openwop-examples`](https://github.com/openwop/openwop-examples).
- The demo app: [`openwop/openwop-app`](https://github.com/openwop/openwop-app).
- Packs and the registry: [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry).
- The site: [`openwop/openwop-site`](https://github.com/openwop/openwop-site).

Each has its own contribution rules and checks.

---

## What's in scope

The corpus describes the **wire contract** between independent workflow hosts and the clients that talk to them. It does not prescribe:

- Internal data structures.
- Storage backends.
- How LLM prompts are built (beyond what the capabilities handshake declares).
- UI conventions. The spec defines only the data on the wire.

A proposal that adds to one of those surfaces probably belongs in an implementation's docs, not the spec.

v2 is the current major. Its contract is [`spec/v2/`](./spec/v2/), [`schemas/v2/`](./schemas/v2/) and [`api/v2/`](./api/v2/). v1 reached end of support on 2026-10-04 ([RFC 0234](./RFCS/0234-maintainer-set-v1-end-of-support.md)). `spec/v1/` and the flat `schemas/*.schema.json` are a frozen tree: don't edit them.

---

## Status labels

Every v2 document carries a status line near its header, for example `> **Status: Stable.**`.

- **Core documents** (`spec/v2/core/*.md`) are `Stable`.
- **Extension documents** (`spec/v2/ext/`) use the labels defined in [`spec/v2/ext/README.md`](./spec/v2/ext/README.md#maturity-labels): `Draft`, `Stable`, `Retired` and `Note`. Each label has a mechanical predicate, and `scripts/check-ext-status-coherence.mjs` checks the labels against committed conformance evidence. A label changes when its predicate is met, not by hand.

---

## Change rules per artifact

### Prose specs (`spec/v2/**/*.md`)

- Every document has a status line (see above).
- Use RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT) only for genuinely normative requirements.
- Link companion documents by relative path. From the repo root, use `[capabilities.md](./spec/v2/core/capabilities.md)`; inside a spec directory, link peers by filename.
- The v2 prose is rendered verbatim on openwop.dev. Keep it readable: short paragraphs, bullets instead of MUST-stacked walls, citations on a Sources line. `scripts/check-spec-readability.mjs` runs in the gate.

### An RFC MUST NOT state a rule a core doc owns

Before you land any normative sentence in `RFCS/*.md`:

1. **Open the `spec/v2/core/*.md` that owns the rule** and read what it already says.
2. **Grep `conformance/src/scenarios/`** for a scenario that asserts it.

The gate does **not** cross-check an RFC's normative claims against the core spec or the suite. The corpus can hold a direct contradiction with every check green. This has happened: an RFC reversed a reader rule owned by `persistence.md` and `events.md`, and it was caught only when a host implemented it.

**Ownership is the test.** When an RFC's argument is sound but the rule is not its to state, record the problem as an open question in the RFC and move the change to the owning document, with its conformance scenarios, in the same PR.

This stays a manual rule because it does not automate. Mechanical proxies (an RFC naming an error code another doc owns; an RFC MUST lacking a scenario) were measured against the corpus: they produce either noise or no signal. The defective RFC above satisfied every structural proxy; the contradiction was semantic.

### JSON Schemas (`schemas/v2/*.schema.json`)

- Every schema declares `$schema: "https://json-schema.org/draft/2020-12/schema"`.
- Every schema has an `$id` under `https://openwop.dev/spec/v2/<name>.schema.json`. (The frozen flat v1 schemas use `https://openwop.dev/spec/v1/`.)
- Use `additionalProperties: false` on every object. Explicit field lists are mandatory, even if a runtime is more lenient.
- New optional fields are additive. New required fields are breaking (see [`COMPATIBILITY.md`](./COMPATIBILITY.md)). Either way, add a `CHANGELOG.md` line.
- Don't run `scripts/derive-v2-schemas.mjs --write`. The v2 schemas were seeded from v1 once and have since been edited by hand; the gate runs it with `--check` only.

Pack-internal schemas (inside a pack's `schemas/` directory) follow the rules in [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry). The pack-manifest schemas themselves stay normative here.

### OpenAPI and AsyncAPI

There are two layers:

- **`api/openapi.yaml` and `api/asyncapi.yaml`** are the v1 wire documents. They are also the **source** that `scripts/derive-v2-api.py` reads.
- **`api/v2/openapi.yaml`, `api/v2/asyncapi.yaml` and `api/seams-v2.yaml`** are **derived**. The script strips the `/v1` prefix, moves seam operations to `api/seams-v2.yaml`, adds the `OpenWOP-Version` header, renames headers, points `$ref`s into `schemas/v2/`, and replaces reader-facing prose from `scripts/derive-v2-api-prose.yaml`. Its header lists every rule.

So, to change the v2 API:

1. Edit the source (`api/openapi.yaml` / `api/asyncapi.yaml`), or `scripts/derive-v2-api-prose.yaml` for a description string. Don't edit `api/v2/` by hand: the gate's `--check` compares a fresh derivation to the committed bytes.
2. Run `python3 scripts/derive-v2-api.py --write` (requires PyYAML).
3. Commit the source and the regenerated outputs together.

Rules for the documents:

- Reference JSON Schemas by cross-file `$ref`; never inline them.
- New endpoints need a `tag`, an `operationId`, request and response schemas, and at least one error response.
- Both layers must lint clean: the gate lints `api/openapi.yaml` and `api/asyncapi.yaml` (steps 2–3) and `api/v2/openapi.yaml`, `api/v2/asyncapi.yaml` and `api/seams-v2.yaml` (step 10). See "Useful commands" below.

### Conformance suite (`conformance/`)

- Each scenario file in `conformance/src/scenarios/` follows the existing pattern:
  - A top-of-file docstring naming the spec document(s) it verifies.
  - `describe('category: …', …)` blocks per assertion group.
  - Assertions that cite the requirement they test, so a failure message names it.
- A new scenario file needs a row in `conformance/scenario-majors.json`, which says which major(s) it targets. Regenerate it with `conformance/scripts/generate-scenario-majors.mjs`: a file named `v2-*` targets major 2. A file with no row never runs.
- New fixtures go in `conformance/fixtures/` **and** in the `fixtures.md` catalog. `spec-corpus-validity.test.ts` fails otherwise.
- **Never return early in silence (RFC 0148 §A).** A test that returns before its first `expect` is a pass with zero assertions.
  - Gate a profile with `behaviorGate(profile, advertised)`.
  - For any other early return, say why: `return softSkip('inapplicable', 'host does not advertise X')`, or `return seamAbsent(reason)` when the host advertises a capability but the seam answers 404/403.
  - If you use vitest's `ctx.skip()`, call `softSkip(...)` first: `ctx.skip()` throws, so anything after it never runs.
  - The runner records a zero-assertion file with no note as `blocked`, and certification treats that as unclassified.
- **Ask whether the condition is causable, not just whether the property is observable.** If a scenario needs a host seam, an operator precondition or a process death to cause its condition, gate on that; don't assert the nearest thing the suite can cause.
- **When a conforming host fails and a lenient one passes, suspect the scenario first.** Check that every field the scenario requires is in the published contract.

### Two rules for scripts

- **Never write the literal you are policing.** A checker that greps the tree for a string must not contain that string, in a comment, an example or its own error message. Build it from parts or read it from the registry the rule comes from.
- **Assert every anchor before you edit anything.** A script that edits several files in sequence stops at the first anchor it can't find, and every later edit silently doesn't happen. Resolve all anchors first, then write.
- **Never run a global substitution over a lockfile or a generated file.** A version bump touches a known set of sites; edit each by address. A blanket `sed` over `package-lock.json` once rewrote an unrelated dependency's version.

---

## Regenerating derived files and running the gate

Many files are generated from others: the v2 API, the gap and register views, `docs/PROTOCOL-STATUS.md`, the requirement registry, the spec-artifacts package, and more. Never hand-edit them. After a change, run the generators in this order, then the gate:

```bash
python3 scripts/derive-v2-api.py --write
node scripts/generate-gaps.mjs --write
node scripts/generate-core-standard-manifest.mjs --write
node scripts/generate-assurance-status.mjs --write
node scripts/generate-protocol-status.mjs --write
(cd conformance && node scripts/generate-scenario-majors.mjs --write)
(cd conformance && node scripts/generate-requirement-registry.mjs --write)
node scripts/generate-spec-artifacts.mjs --write
node scripts/generate-review-packet.mjs --write
node scripts/generate-v1-eos-clock.mjs --write
node scripts/report-v2-witness-coverage.mjs --write
node scripts/check-spec-coherence.mjs --write

npm run openwop:check
```

Skip a generator only if you are sure none of its inputs changed. An edit made after the chain can make one stale again, so run the chain last.

`npm run openwop:check` (`scripts/openwop-check.sh`) is the merge gate. It mirrors `.github/workflows/openwop-spec.yml` and runs ten steps:

1. Conformance suite: typecheck, host-free scenarios, and the corpus-coherence tests (every schema compiles, every fixture validates, links resolve, prose carries a status line).
2. `api/openapi.yaml` lints clean (redocly).
3. `api/asyncapi.yaml` validates (AsyncAPI CLI).
4. Generated surfaces are current, plus the register, RFC-status and waiver checks.
5. Publish metadata and npm package contents.
6. Security invariants: every protocol-tier MUST NOT in `SECURITY/invariants.yaml` has a matching public test.
7. Published-layout collection.
8. Advertised package versions.
9. Published-version identity.
10. The v2 tree: declaration, generators, spec-readability budget, paths, deprecation dates, retirement and surface monotonicity, bundle maturity, the Accepted predicate, and lint/validation of `api/v2/openapi.yaml`, `api/v2/asyncapi.yaml` and `api/seams-v2.yaml`.

Beyond the gate, a PR also needs:

- **A `CHANGELOG.md` line** under `[Unreleased]` when it changes any artifact, in the form `- **Short lead.** one sentence` saying what changed for an implementer. Leave out commit hashes, pass counts and how the change was found. `scripts/check-changelog-shape.mjs` enforces the shape.
- **A `Signed-off-by:` trailer** on every commit (see "Sign your commits" below).

### Optional pre-commit hook

```bash
bash scripts/install-git-hooks.sh
```

This links `scripts/hooks/pre-commit` into `.git/hooks/`. It is fast (under a second) and fires only when staged paths match `RFCS/*.md`, catching an RFC change staged without regenerating `docs/PROTOCOL-STATUS.md` and `README.md`.

---

## Process

- **Pull requests** go to this repository, labelled `openwop-spec` when they touch the spec corpus.
- **Issues:** name the document, the section, the requirement that is unclear or contradictory, and the impact on implementations.
- **Compatibility:** [`COMPATIBILITY.md`](./COMPATIBILITY.md) decides what is additive and what is breaking.
- **Normative changes** need an RFC: see [`RFCS/README.md`](./RFCS/README.md).
- **Review rules** (approvals, comment windows and how they are waived while the project has one maintainer) are in [`GOVERNANCE.md`](./GOVERNANCE.md), in "Decision making", "Spec change process" and "Sole-steward operation". Every waived comment window is recorded in the waiver ledger in [`MAINTAINERS.md`](./MAINTAINERS.md).

### Bootstrap-phase notes

Older RFCs cite this section for the comment-window waiver and one-approval review used while the project has a single maintainer. Those rules now live in [`GOVERNANCE.md`](./GOVERNANCE.md) §"Sole-steward operation", and every waiver is recorded in [`MAINTAINERS.md`](./MAINTAINERS.md).

---

## Sign your commits (DCO)

Every commit on a pull request MUST carry a `Signed-off-by:` trailer. This is the [Developer Certificate of Origin](https://developercertificate.org/), a lightweight alternative to a CLA. By signing off, you assert you have the right to submit the work under the project's license (Apache-2.0 for code, CC-BY-4.0 for spec text).

```bash
git commit -s -m "your message"             # adds Signed-off-by automatically
git commit --amend -s --no-edit             # add it to an existing commit
git rebase --signoff HEAD~3                 # add it to the last 3 commits
```

The [DCO bot](https://github.com/dcoapp/app) runs on every PR and blocks merge until every commit is signed off. To fix a failing check, amend, force-push, and it re-runs.

While the project has one maintainer (see [`GOVERNANCE.md`](./GOVERNANCE.md) §"Sole-steward operation"), the steward's own commits to `main` don't go through a PR, so the DCO bot doesn't see them and they may lack the trailer. That exemption is recorded here for transparency. It ends when a second maintainer joins. External contributions MUST be signed.

---

## Response times

A maintainer will respond to your PR or issue within:

- **24 hours** for security-flagged issues (see [`SECURITY.md`](./SECURITY.md)).
- **7 calendar days** for everything else.

"Respond" means substantive: a review, a redirect, or a date by which it will be looked at. If 7 days pass without one, ping the lead maintainer listed in [`MAINTAINERS.md`](./MAINTAINERS.md).

A PR waiting more than 14 days without a substantive response is a maintainer capacity problem, not a problem with your contribution.

---

## Useful commands

```bash
# Host-free conformance subset
# (build the CLI once: cd conformance && npm install && npm run build:cli)
conformance/dist/cli.js --offline

# Lint OpenAPI (pinned to the gate's version)
npx -y -p @redocly/cli@2.31.4 redocly lint api/openapi.yaml
(cd api/v2 && npx -y -p @redocly/cli@2.31.4 redocly lint openapi.yaml)
npx -y -p @redocly/cli@2.31.4 redocly lint api/seams-v2.yaml --config api/v2/redocly.yaml

# Validate AsyncAPI (4.1.1 is the last Node-22-compatible release)
npx -y -p @asyncapi/cli@4.1.1 asyncapi validate api/asyncapi.yaml
npx -y -p @asyncapi/cli@4.1.1 asyncapi validate api/v2/asyncapi.yaml

# Check that api/v2 matches its source
python3 scripts/derive-v2-api.py --check
```
