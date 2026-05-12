---
name: update-conformance
description: Sync the conformance suite (@openwop/openwop-conformance) to a spec change. Adds/edits scenarios in conformance/src/scenarios/, fixtures in conformance/fixtures/ + fixtures.md catalog, capability gating per coverage.md, CHANGELOG entry, and bumps suite version per the spec major/minor rule.
---

# Update Conformance Suite (openwop)

You are now in **Conformance Sync Mode** — a workflow for syncing changes from the openwop spec corpus (`spec/v1/`, `RFCS/`, `schemas/`, `api/`) to the black-box conformance suite at `conformance/` and the published package `@openwop/openwop-conformance`.

## Task: $ARGUMENTS

---

## Reference

- **Spec corpus:** `spec/v1/`, `RFCS/`, `schemas/`, `api/openapi.yaml`, `api/asyncapi.yaml`
- **Conformance package:** `conformance/` — published as `@openwop/openwop-conformance` on npm
- **Coverage map:** `conformance/coverage.md` — table of which spec sections are covered, including the §"Capability-gated scenarios" subsection
- **Fixtures catalog:** `conformance/fixtures.md` — every file in `conformance/fixtures/` must appear with its contract
- **Suite README:** `conformance/README.md` — how to run the suite against a target host
- **CLI:** `conformance/src/cli.ts` — installs as `openwop-conformance`; supports `--offline` server-free subset
- **Per-package CHANGELOG:** `conformance/CHANGELOG.md`

---

## Conformance Package Architecture

### Directory structure

```
conformance/
├── src/
│   ├── cli.ts                 # Entry point — installs as openwop-conformance
│   ├── setup.ts               # Test harness setup, capability resolution, driver init
│   ├── lib/                   # Shared helpers (assertion framing, capability gating)
│   └── scenarios/             # Black-box assertions, one file per spec area
│       ├── spec-corpus-validity.test.ts    # Ajv2020 compile every schema, round-trip fixtures
│       ├── fixtures-valid.test.ts          # Validate every fixture against workflow-definition.schema.json
│       └── <area>.test.ts                  # Per-spec-doc scenarios
├── fixtures/                  # Canonical wire fixtures (workflows, events, capabilities)
├── fixtures.md                # Catalog + per-fixture contracts
├── coverage.md                # Spec section → scenario mapping; capability-gated section
├── package.json               # @openwop/openwop-conformance
├── tsconfig.json              # strict
└── vitest.config.ts           # Vitest runner config
```

### Key patterns

| Pattern | Detail |
|---|---|
| **Scenario shape** | Top-of-file docstring naming the spec doc(s); `describe('category: ...', ...)` blocks per assertion group; `expect(..., driver.describe('spec.md §section', 'requirement'))` framing |
| **Capability gating** | Scenarios that test optional surface skip when the host doesn't advertise the relevant `/.well-known/openwop` flag — wrapper utility in `src/lib/` |
| **Server-free subset** | `--offline` flag runs `spec-corpus-validity.test.ts` + `fixtures-valid.test.ts` + any scenario that doesn't need `OPENWOP_BASE_URL`. Runtime budget: <1s per scenario (CI gate) |
| **Strict-mode** | `OPENWOP_REQUIRE_BEHAVIOR=true` per `conformance/coverage.md` §"Capability-gated scenarios" — fails when a host advertises a capability but its scenarios fail |
| **Suite versioning** | `@openwop/openwop-conformance` major tracks spec major (1.x for v1); minor adds scenarios; patch yanks/fixes. Hosts advertise the suite version they pass (`INTEROP-MATRIX.md`) |
| **Build** | `npm run build:cli` — `tsc -p tsconfig.build.json` → `dist/cli.js`; `chmod +x` |
| **Test runner** | Vitest 3.x |
| **Schema engine** | Ajv 8 + ajv-formats |

### Coordinated artifacts

Per `CONTRIBUTING.md` §"Conformance suite":

| Change in spec | Conformance impact |
|---|---|
| New schema in `schemas/` | `spec-corpus-validity.test.ts` automatically picks it up via Ajv compile; new scenarios may be needed if behavior is normative |
| New endpoint in `api/openapi.yaml` | New scenario in `conformance/src/scenarios/`; possibly new fixture; SDK method added (per `/code-review`) |
| New event in `api/asyncapi.yaml` | New scenario asserting the event shape + emission conditions; SSE stream-mode test if applicable |
| New required field in an existing schema | All existing fixtures using that schema must be updated; `fixtures-valid.test.ts` will fail otherwise — pair the spec change with the fixture refresh |
| New optional field | Existing fixtures unchanged; new scenario asserting the field is forward-compatible |
| New capability in `capabilities.schema.json` | New scenario gated on `host.<flag>.supported`; coverage.md §"Capability-gated scenarios" updated |
| New profile in `profiles.md` | New scenario asserting profile predicate; INTEROP-MATRIX rows updated |
| New SECURITY MUST-NOT | Invariant row in `SECURITY/invariants.yaml` + matching public scenario (gate enforced by `scripts/check-security-invariants.sh`) |
| RFC moves Draft → Active | Reserve scenario file names in `conformance/src/scenarios/`; implement when RFC reaches Accepted |
| RFC moves Active → Accepted | Scenarios merged; coverage.md updated; suite minor bumped |

---

## Workflow

### Step 1: Identify what changed in the spec

Read the relevant files in the spec corpus to understand the change:

```bash
# Recent corpus changes
git log --oneline -20 -- spec/v1/ schemas/ api/ RFCS/
git diff HEAD~1 -- spec/v1/ schemas/ api/

# What scenarios cover the affected docs today
git diff HEAD~1 --name-only -- spec/v1/ | xargs -I{} basename {} | sed 's/\.md$//' | while read doc; do
  echo "=== Scenarios covering $doc ==="
  grep -rl "$doc" conformance/src/scenarios/ 2>/dev/null
done
```

Identify the **lane**:
- New endpoint → need scenario(s) covering request/response, error cases, idempotency
- New event → need scenario asserting emission conditions + stream-mode visibility
- New schema field → need scenario asserting the field appears (if required) or is optional (if optional)
- New capability → need gated scenario set
- New profile → need profile-predicate scenario
- New invariant → need public test enforcing the MUST-NOT
- New RFC at Accepted → need scenarios covering the RFC's "Conformance" section

### Step 2: Find the right scenario file

Search `conformance/src/scenarios/` for the appropriate file:

```bash
# Existing scenarios by area
ls conformance/src/scenarios/

# Find the closest existing scenario for the touched spec doc
grep -rl "spec/v1/<doc>.md\|spec.v1.<doc>\.md" conformance/src/scenarios/
```

**Decision:**
- An existing scenario file covers this area → extend it with a new `describe` block
- No existing file → create `conformance/src/scenarios/<area>.test.ts`

File naming: one scenario file per spec area, named after the spec doc it primarily verifies (e.g., `interrupt.test.ts`, `capabilities.test.ts`, `webhooks.test.ts`).

### Step 3: Draft the scenario

Follow the canonical pattern per `CONTRIBUTING.md` §"Conformance suite":

```typescript
// conformance/src/scenarios/<area>.test.ts
//
// Verifies: spec/v1/<area>.md §<Section heading>
// Verifies: RFCS/NNNN-<slug>.md §Proposal (if RFC-bound)
//
// Capability gating: requires `host.<flag>.supported = true` advertised in /.well-known/openwop

import { describe, it, expect } from 'vitest';
import { driver, capability } from '../lib';

describe('<area>: <capability>', () => {
  describe('positive: <happy path>', () => {
    it('asserts <wire shape>', async () => {
      await capability.requires('host.<flag>.supported');
      const run = await driver.startRun(/* fixture */);
      // ...
      expect(run.<field>, driver.describe('<area>.md §<Section>', '<requirement>')).toEqual(/* expected */);
    });
  });

  describe('negative: <error path>', () => {
    it('rejects <invalid input>', async () => {
      const result = await driver.startRunExpectingError(/* bad fixture */);
      expect(result.status, driver.describe('<area>.md §<Section>', '<error requirement>')).toBe(400);
      expect(result.body.code, driver.describe('<area>.md §<Section>', '<error code>')).toBe('<canonical error code>');
    });
  });
});
```

Per `CONTRIBUTING.md` and `conformance/coverage.md`:

- Top-of-file docstring naming the spec doc(s)
- `describe('category: ...', ...)` per group
- Every `expect(...)` uses `driver.describe('spec.md §section', 'requirement')` framing
- Capability gating via `capability.requires('host.<flag>.supported')` (skip if not advertised) OR runs unconditionally if surface is mandatory v1 core
- Server-free scenarios: <1s runtime (CI gate)
- Positive AND negative cases (every error code path tested)

### Step 4: Add fixtures (if needed)

If the new surface requires a new wire fixture:

```bash
# Place under conformance/fixtures/
ls conformance/fixtures/
```

Each fixture is canonical wire data — a `workflow-definition.json`, an event payload, a capabilities response, etc. Per `CONTRIBUTING.md`:

- New fixtures MUST be added to `conformance/fixtures.md`'s catalog table + per-fixture contracts. `spec-corpus-validity.test.ts` round-trip test will fail otherwise.
- Fixtures must validate against their target schema (`fixtures-valid.test.ts` enforces this)
- File naming: `<area>-<scenario>.json`

Update `conformance/fixtures.md`:

```markdown
## Catalog

| File | Schema | Purpose | Used by |
|---|---|---|---|
| `<area>-<scenario>.json` | `schemas/<name>.schema.json` | <one-line> | `conformance/src/scenarios/<area>.test.ts` |
```

### Step 5: Update coverage.md

`conformance/coverage.md` maps spec sections to scenarios. Add a row for every spec section the new scenario verifies. For capability-gated scenarios, add a row under §"Capability-gated scenarios" naming the flag.

```markdown
## Coverage

| Spec section | Scenario | Status |
|---|---|---|
| `<area>.md §<Section>` | `conformance/src/scenarios/<area>.test.ts` → `<area>: <capability>` | Covered |

## Capability-gated scenarios

| Capability | Flag | Scenarios |
|---|---|---|
| <Name> | `host.<flag>.supported` | `<area>.test.ts` |
```

### Step 6: Verify locally

```bash
# Typecheck
( cd conformance && npx tsc --noEmit )

# Server-free subset (the `--offline` gate; <1s scenarios only)
( cd conformance && npx vitest run src/scenarios/spec-corpus-validity.test.ts src/scenarios/fixtures-valid.test.ts )

# Full suite against a local host (in-memory reference)
( cd examples/hosts/in-memory && npm start &
  sleep 2
  OPENWOP_BASE_URL=http://localhost:3000 ( cd ../../../conformance && npx vitest run )
)

# Strict-mode if the new scenario is capability-gated
OPENWOP_BASE_URL=http://localhost:3000 OPENWOP_REQUIRE_BEHAVIOR=true \
  ( cd conformance && npx vitest run src/scenarios/<area>.test.ts )

# Build the CLI (validates emit)
( cd conformance && npm run build:cli )
ls -la conformance/dist/cli.js
```

### Step 7: Update CHANGELOG + suite version

```bash
# Per-package CHANGELOG for new scenarios (minor bump if additive)
cat conformance/CHANGELOG.md
```

Add under `[Unreleased]`:

```markdown
### Added
- Scenario `<area>: <capability>` covering `spec/v1/<area>.md §<Section>` (gated on `host.<flag>.supported`)

### Changed
- (none)
```

**Version bump rules (per `COMPATIBILITY.md` §1):**
- Additive scenarios → bump conformance suite **minor** (e.g., 1.0.0 → 1.1.0). Hosts that passed 1.0.0 are not required to pass 1.1.0; they advertise the version they pass.
- Yank/fix → patch
- Spec major bump → suite major bump

### Step 8: Update reference-host evidence

After scenarios land, the reference hosts that advertise the affected profile must re-run the suite and update their `conformance.md`:

```bash
# For each host that should advertise the new surface
for host in in-memory sqlite python; do
  echo "Run conformance against $host, update examples/hosts/$host/conformance.md with:"
  echo "  - Suite version"
  echo "  - Command used"
  echo "  - Target URL class"
  echo "  - Pass/fail/skip counts"
done

# INTEROP-MATRIX.md row reflects the new profile claim
grep -E '^\| \*\*(In-memory|SQLite|Python in-memory)\*\*' INTEROP-MATRIX.md
```

If a host can't pass the new scenarios but previously advertised the relevant profile → **either implement the missing surface, OR downgrade the advertisement in INTEROP-MATRIX**. Don't quietly leave a dishonest claim.

### Step 9: Report

Summarize:
- What changed in the spec
- What scenarios + fixtures were added
- coverage.md update
- conformance/CHANGELOG.md entry
- Suite version impact (minor/patch)
- Reference-host evidence refreshes pending

---

## Common Scenarios

### Adding a new endpoint

1. Identify the spec doc + section (`spec/v1/rest-endpoints.md` plus area-specific doc)
2. Add scenarios to the area-specific scenario file (e.g., `webhooks.test.ts` for a webhook endpoint)
3. Positive case: happy-path request → expected response
4. Negative cases: each documented error code from the OpenAPI definition
5. Idempotency case (if applicable per `idempotency.md`): same `Idempotency-Key` → same response
6. Capability-gate if the endpoint is optional surface
7. Update coverage.md
8. Bump suite minor; add CHANGELOG entry

### Adding a new event type

1. Identify the spec doc + section (`spec/v1/<area>.md` plus `stream-modes.md`)
2. Add scenario asserting the event is emitted under the documented conditions
3. Add scenarios for each stream mode (`values` / `updates` / `messages` / `debug`) where the event should be visible
4. Negative case: stream modes where the event must NOT appear
5. SSE-specific: heartbeat / `:` comment line interaction
6. Webhook subscription scenario if the event is webhook-eligible
7. Capability-gate if the event is optional
8. Update coverage.md, fixtures.md

### Adding a new capability flag

1. Identify the flag in `capabilities.schema.json` and `host-capabilities.md`
2. Add scenario asserting:
   - When advertised, the host implements the documented surface
   - When NOT advertised, the host returns 501 / 404 / capability-missing-error on the gated endpoint
3. Cross-add gating to every scenario that depends on the flag
4. Update coverage.md §"Capability-gated scenarios"
5. INTEROP-MATRIX: reference hosts that advertise the flag update their `conformance.md`

### Adding a new SECURITY invariant

1. Add row to `SECURITY/invariants.yaml`:
   ```yaml
   - id: INV-<NNN>
     must_not: <one-line MUST-NOT>
     spec_section: <area>.md §<Section>
     test_file: conformance/src/scenarios/<area>.test.ts
   ```
2. Add scenario asserting the negative case (operation that violates the MUST-NOT must be rejected)
3. Run `bash scripts/check-security-invariants.sh` to verify the invariant ↔ test linkage holds

### Updating after an RFC moves Active → Accepted

1. Read the RFC's "Conformance" + "Acceptance criteria" sections
2. Verify scenarios exist for each requirement listed
3. If scenarios are stubbed (`it.todo(`), implement them
4. Update coverage.md to mark covered
5. Bump suite minor
6. Update RFC Status to `Accepted` with the date

---

## Important notes

- The conformance package is **published**. `npm publish` for `@openwop/openwop-conformance` is gated on `npm run openwop:check` passing — including `scripts/openwop-check-publish-metadata.sh` and `scripts/check-npm-pack-contents.sh`. A bad scenario landing on `main` will block release.
- Scenarios are **the source of truth for behavior**. When prose and scenario diverge, the scenario wins and the prose is updated to match. Never the reverse.
- **Capability gating is the only acceptable way to add scenarios for optional surface.** Adding unconditional scenarios for optional surface breaks every host that didn't opt in, retroactively invalidating their `1.x.0` conformance pass.
- **Strict-mode (`OPENWOP_REQUIRE_BEHAVIOR=true`)** is for hosts that want to test rigor against capabilities they advertise. It is not the default.
- Fixtures are **public**. Don't include private deployment identifiers, secrets, internal URLs, or tenant IDs.
- After scenarios land, ensure the **TypeScript SDK is in sync**: every endpoint has a method on `OpenwopClient` (per `CONTRIBUTING.md` §"TypeScript reference SDK").

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` | Begin Step 1 — identify spec change |
| `scaffold <area>` | Create or edit the scenario file with the canonical pattern |
| `fixture <name>` | Add a fixture + `fixtures.md` row |
| `gate <flag>` | Wrap selected scenarios in `capability.requires('host.<flag>.supported')` and add a coverage.md row |
| `bump <minor\|patch>` | Update `conformance/package.json` + CHANGELOG accordingly |
| `verify` | Run Step 6 — typecheck + server-free + against in-memory host |
| `evidence <host>` | Update `examples/hosts/<host>/conformance.md` with fresh pass/fail/skip counts |
| `report` | Generate the Step 9 summary |
| `done` | Complete sync |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/architect` | Pre-implementation review — wire-shape + version-negotiation + capability gating |
| `/code-review` | Banned-pattern + assertion-framing review of the scenarios |
| `/nfr` | NFR checklist — confirms coverage.md, fixtures.md, CHANGELOG, INTEROP-MATRIX updates |
| `/update-docs` | Sync README "Document index" + ROADMAP if the change closes a gap |
| `/cleanup audit fixtures` | Verify every fixture in `conformance/fixtures/` is registered in `fixtures.md` |
| `/pr` | Create the PR — applies `openwop-spec` label |
