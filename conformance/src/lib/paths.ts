/**
 * Layout-aware path resolver for the offline subset.
 *
 * The same suite source runs in two layouts:
 *
 *   1. Repo checkout — `openwop/conformance/src/scenarios/X.test.ts`. Schemas,
 *      api/, and prose docs live one level above the conformance package
 *      at the repo root.
 *
 *   2. Published tarball — `node_modules/@openwop/openwop-conformance/src/...`.
 *      The `prepack` script vendors `api/` and `schemas/` INTO the package,
 *      so they resolve relative to the package root instead of a parent.
 *      Spec prose (`spec/v1/*.md`) is NOT bundled — those tests skip.
 *
 * Earlier offline scenarios computed `__dirname/../../..` to find
 * the repo root. That works in a checkout but lands in `node_modules/@openwop/`
 * after npx-style install, breaking `npx -y @openwop/openwop-conformance --offline`
 * with `ENOENT: ... node_modules/@openwop/schemas/workflow-definition.schema.json`.
 *
 * This module centralises the resolution. Strategy:
 *
 *   - If `OPENWOP_CONFORMANCE_ROOT` is set, treat its value as the layout root
 *     (the directory that contains `schemas/`, `api/`, and either
 *     `conformance/fixtures/` (repo) or `fixtures/` directly (vendored)).
 *     Used by integrators who put the suite in an unusual location.
 *
 *   - Otherwise compute the package root from `import.meta.url` (= the
 *     directory containing `package.json`) and probe whether the schemas
 *     are vendored at the package root (published) or at the parent (repo).
 *
 * Exported paths are non-null for the materials always present in both
 * layouts; the prose-doc and fixtures.md catalog dirs may resolve to
 * `null` under the published layout, in which case the corresponding
 * scenarios skip cleanly (see `spec-corpus-validity.test.ts`).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve as pathResolve } from 'node:path';

// `dirname(fileURLToPath(import.meta.url))` for an ESM module compiled or
// run from `src/lib/paths.ts` returns `<pkg>/src/lib/`. The conformance
// package root is therefore two directories above this file in BOTH the
// repo checkout and the published tarball — the source layout is
// identical between the two; only the parent of `<pkg>` differs.
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = pathResolve(HERE, '..', '..');

interface ResolvedLayout {
  /** Conformance package directory (where `package.json` lives). */
  readonly pkgRoot: string;
  /** Directory containing JSON Schemas. */
  readonly schemasDir: string;
  /** Directory containing the OpenAPI/AsyncAPI specs. */
  readonly apiDir: string;
  /** Directory containing the conformance fixtures (top-level + sub-dirs). */
  readonly fixturesDir: string;
  /** Directory containing scenario test files, if present in this layout. */
  readonly scenariosDir: string | null;
  /** Path to the conformance package README, if present in this layout. */
  readonly conformanceReadmePath: string | null;
  /** Path to `fixtures.md` catalog, if present in this layout. */
  readonly fixturesDocPath: string | null;
  /** Path to `coverage.md` operation-coverage map, if present in this layout. */
  readonly coverageDocPath: string | null;
  /** Directory containing v1 prose docs (`*.md`), if present in this layout. */
  readonly v1Dir: string | null;
  /**
   * Directory containing the v2 corpus data (`declaration.json`, the codemap,
   * `spec/v2/core/*.md`), if present in this layout.
   *
   * Anchored on the CONTRACT root, not the layout root, because that is the
   * only anchor that holds in both shapes: in a repo checkout the contract
   * root is the repo and `spec/v2/` sits inside it; in a published install it
   * is the `@openwop/spec-artifacts` peer, which ships `spec/` while the
   * conformance package ships none. A resolver anchored on `v1Dir` instead
   * (the shape before 2.0.6) returned null for every consumer of the published
   * package, because `spec/v1/` is a repo-only directory — so a v2 lookup was
   * routed through a v1 probe and every published layout silently lost the
   * data. See `era2-seed.registeredOrgs`.
   */
  readonly specV2Dir: string | null;
  /** Path to repository README.md, if present in this layout. */
  readonly readmePath: string | null;
  /** Path to the TypeScript SDK run-helper source, if present in this layout. */
  readonly typescriptRunHelpersPath: string | null;
  /** Path to the Python SDK types source, if present in this layout. */
  readonly pythonTypesPath: string | null;
  /** Path to the Go SDK types source, if present in this layout. */
  readonly goTypesPath: string | null;
  /** Discriminator — which layout did we resolve to? */
  readonly layout: 'env-override' | 'repo' | 'published';
}

/**
 * Suite 2.0.0 (RFC 0168 §D.2): in the published layout the CONTRACT (api/ and
 * schemas/) is the `@openwop/spec-artifacts` peer package, not files vendored
 * into this tarball. Resolve its root through Node's resolver from this package
 * so the host's installed peer is what the suite validates against.
 */
function resolvePeerRoot(): string | null {
  try {
    const req = createRequire(join(PKG_ROOT, 'package.json'));
    return dirname(req.resolve('@openwop/spec-artifacts/package.json'));
  } catch {
    return null;
  }
}

function resolveFromRoot(root: string, layout: ResolvedLayout['layout'], contractRoot: string = root): ResolvedLayout {
  // Two on-disk shapes for the layout root:
  //   - Repo: <root>/schemas, <root>/api, <root>/conformance/fixtures,
  //           <root>/conformance/{fixtures.md,coverage.md}, <root>/spec/v1/*.md
  //     (Where `<root>` = the repo root, e.g. `openwop/`.)
  //   - Vendored / published: <root>/schemas, <root>/api, <root>/fixtures,
  //           <root>/fixtures.md (when bundled), no spec/v1.
  // Probe by checking whether `schemas/` lives at the conformance pkg root
  // (vendored) vs one level up (repo).
  const schemasDir = join(contractRoot, 'schemas');
  const apiDir = join(contractRoot, 'api');
  const repoFixturesDir = join(root, 'conformance', 'fixtures');
  const vendoredFixturesDir = join(root, 'fixtures');
  const fixturesDir = existsSync(repoFixturesDir) ? repoFixturesDir : vendoredFixturesDir;
  const repoScenariosDir = join(root, 'conformance', 'src', 'scenarios');
  const vendoredScenariosDir = join(PKG_ROOT, 'src', 'scenarios');
  const scenariosDir = existsSync(repoScenariosDir)
    ? repoScenariosDir
    : existsSync(vendoredScenariosDir)
      ? vendoredScenariosDir
      : null;
  const repoConformanceReadme = join(root, 'conformance', 'README.md');
  const vendoredConformanceReadme = join(PKG_ROOT, 'README.md');
  const conformanceReadmePath = existsSync(repoConformanceReadme)
    ? repoConformanceReadme
    : existsSync(vendoredConformanceReadme)
      ? vendoredConformanceReadme
      : null;
  const repoFixturesDoc = join(root, 'conformance', 'fixtures.md');
  const vendoredFixturesDoc = join(root, 'fixtures.md');
  const fixturesDocPath = existsSync(repoFixturesDoc)
    ? repoFixturesDoc
    : existsSync(vendoredFixturesDoc)
      ? vendoredFixturesDoc
      : null;
  const repoCoverageDoc = join(root, 'conformance', 'coverage.md');
  const vendoredCoverageDoc = join(root, 'coverage.md');
  const coverageDocPath = existsSync(repoCoverageDoc)
    ? repoCoverageDoc
    : existsSync(vendoredCoverageDoc)
      ? vendoredCoverageDoc
      : null;
  const v1Probe = join(root, 'spec', 'v1');
  const v1Dir = existsSync(v1Probe) ? v1Probe : null;
  const specV2Probe = join(contractRoot, 'spec', 'v2');
  const specV2Dir = existsSync(specV2Probe) ? specV2Probe : null;
  const readmeProbe = join(root, 'README.md');
  const readmePath = existsSync(readmeProbe) ? readmeProbe : null;
  const typescriptRunHelpersProbe = join(root, 'sdk', 'typescript', 'src', 'run-helpers.ts');
  const typescriptRunHelpersPath = existsSync(typescriptRunHelpersProbe) ? typescriptRunHelpersProbe : null;
  const pythonTypesProbe = join(root, 'sdk', 'python', 'src', 'openwop_client', 'types.py');
  const pythonTypesPath = existsSync(pythonTypesProbe) ? pythonTypesProbe : null;
  const goTypesProbe = join(root, 'sdk', 'go', 'types.go');
  const goTypesPath = existsSync(goTypesProbe) ? goTypesProbe : null;
  return {
    pkgRoot: PKG_ROOT,
    schemasDir,
    apiDir,
    fixturesDir,
    scenariosDir,
    conformanceReadmePath,
    fixturesDocPath,
    coverageDocPath,
    v1Dir,
    specV2Dir,
    readmePath,
    typescriptRunHelpersPath,
    pythonTypesPath,
    goTypesPath,
    layout,
  };
}

function resolveLayout(): ResolvedLayout {
  const override = process.env.OPENWOP_CONFORMANCE_ROOT?.trim();
  if (override && override.length > 0) {
    return resolveFromRoot(pathResolve(override), 'env-override');
  }
  // Vendored / published-tarball layout: `prepack` copies `schemas/` +
  // `api/` to the package root. Repo layout: schemas live one level
  // above the conformance package.
  //
  // Edge case: a developer running `npm pack` locally without a
  // postpack cleanup leaves schemas/ in BOTH places transiently. When
  // both exist, prefer the parent (repo layout) so prose-doc tests
  // continue to run — the parent is the canonical source.
  const parent = pathResolve(PKG_ROOT, '..');
  const parentHasSchemas = existsSync(join(parent, 'schemas'));
  const pkgHasSchemas = existsSync(join(PKG_ROOT, 'schemas'));
  if (parentHasSchemas) {
    return resolveFromRoot(parent, 'repo');
  }
  const peer = resolvePeerRoot();
  if (peer) {
    return resolveFromRoot(PKG_ROOT, 'published', peer);
  }
  if (pkgHasSchemas) {
    // A pre-2.0 tarball layout (schemas vendored in-package); kept so an old
    // layout still resolves, but the 2.x stamp check refuses to run without the peer.
    return resolveFromRoot(PKG_ROOT, 'published');
  }
  // Neither — return the published-style resolution rooted at PKG_ROOT
  // so error messages name a concrete directory rather than a
  // computed-from-undefined path.
  return resolveFromRoot(PKG_ROOT, 'published');
}

const _layout = resolveLayout();

export const PKG_ROOT_PATH: string = _layout.pkgRoot;
export const SCHEMAS_DIR: string = _layout.schemasDir;
export const API_DIR: string = _layout.apiDir;
export const FIXTURES_DIR: string = _layout.fixturesDir;
export const SCENARIOS_DIR: string | null = _layout.scenariosDir;
export const CONFORMANCE_README_PATH: string | null = _layout.conformanceReadmePath;
export const FIXTURES_DOC_PATH: string | null = _layout.fixturesDocPath;
export const COVERAGE_DOC_PATH: string | null = _layout.coverageDocPath;
export const V1_DIR: string | null = _layout.v1Dir;
export const SPEC_V2_DIR: string | null = _layout.specV2Dir;
export const README_PATH: string | null = _layout.readmePath;
export const TYPESCRIPT_RUN_HELPERS_PATH: string | null = _layout.typescriptRunHelpersPath;
export const PYTHON_TYPES_PATH: string | null = _layout.pythonTypesPath;
export const GO_TYPES_PATH: string | null = _layout.goTypesPath;
export const LAYOUT: ResolvedLayout['layout'] = _layout.layout;

/** Test-only — re-resolve in case env var or filesystem changed. */
export function __resolveLayoutForTests(): ResolvedLayout {
  return resolveLayout();
}
