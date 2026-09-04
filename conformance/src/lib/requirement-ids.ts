/**
 * Per-`it` requirement ids (RFC 0148 §A, gap G3; v2 charter Phase 1).
 *
 * The ledger has recorded ONE row per scenario FILE (`openwop.floor.<file>` /
 * `openwop.scenario.<file>`). That granularity is what produces certification
 * gap G8: a file that asserted a positive control and then soft-skipped the
 * requirement still resolves to `executed-pass` for the whole file. The durable
 * fix named in `scenario-disposition.ts` is per-`it` recording — this module
 * supplies the ids for it.
 *
 * Why the id derives from the TEST TITLE and not from the `driver.describe`
 * text: 190 of 1,756 citations interpolate the requirement text at run time
 * (`docs/REQUIREMENT-REGISTRY-FEASIBILITY.md`), so no text-derived id can be
 * stable for them. Test titles are literals in every scenario file, stable
 * across hosts, and already the unit vitest reports on. The registry
 * (`conformance/requirements.json`, generated) maps each id back to the
 * citations found inside that test's body, so a bundle reader can still ask
 * "which spec section did this row witness".
 *
 * Grammar: `openwop.it.<file-stem>.<title-slug>` where the stem is the scenario
 * file name without `.test.ts` and the slug is the title lower-cased, every run
 * of non-alphanumerics folded to one `-`, trimmed, and capped at 80 characters.
 * A second test in the same file whose title slugs identically gets `~2`,
 * `~3`, … (vitest allows duplicate titles; the ledger does not allow duplicate
 * ids). A scenario MAY override the derived id for the current test with
 * `req()` when it wants a hand-authored, registry-listed id.
 *
 * requireExplicitIds (suite 2.0.0, RFC 0168 §A.1): from 2.0.0 `req(id, section,
 * requirement)` is the ONLY assertion-message form in `src/scenarios` and
 * `src/coherence` — `driver.describe(section, requirement)` is gone from every
 * scenario, and `scripts/check-req-only.mjs` (root) fails the gate when a
 * scenario reintroduces it, when an `expect` carries a bare string message,
 * when an `it` body returns without `softSkip` / `seamAbsent`, or when two
 * `it`s in one file share an explicit id. Every `it` therefore names the
 * requirement it witnesses on the wire; the title-derived allocator below is
 * the fallback for an `it` that makes no cited assertion at all. The ids the
 * 2.0.0 sweep wrote are exactly the ids the allocator derived in 1.x (same
 * stem + slug + `~n` order), so no bundle id changed at the cut-over; an `it`
 * with an interpolated title carries a hand-minted id from the static parts of
 * its title, unique within the file.
 */

export const IT_ID_PREFIX = 'openwop.it.';
export const IT_ID_GRAMMAR = /^openwop\.it\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*(?:~[2-9][0-9]*)?$/;

const MAX_SLUG = 80;

/** Title → slug: lower-case, non-alphanumeric runs → `-`, trimmed, capped. */
export function slugTitle(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const capped = s.length > MAX_SLUG ? s.slice(0, MAX_SLUG).replace(/-+$/g, '') : s;
  return capped.length > 0 ? capped : 'untitled';
}

/** `auth-subject-link.test.ts` → `auth-subject-link`. */
export function fileStem(scenarioFile: string): string {
  return scenarioFile.replace(/\.test\.ts$/, '');
}

/** Derived id for one test, before collision suffixing. */
export function itRequirementId(scenarioFile: string, title: string): string {
  return `${IT_ID_PREFIX}${fileStem(scenarioFile)}.${slugTitle(title)}`;
}

/** The scenario file a per-`it` id belongs to, or null when the id is not one. */
export function scenarioFileOfItId(requirementId: string): string | null {
  if (!requirementId.startsWith(IT_ID_PREFIX)) return null;
  const rest = requirementId.slice(IT_ID_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  return `${rest.slice(0, dot)}.test.ts`;
}

/**
 * Every FILE-derived id back to its file: the per-test `openwop.it.<stem>.<title>`
 * plus the per-file rows the ledger also carries, `openwop.scenario.<stem>` and
 * `openwop.floor.<stem>`. Gate rows (`openwop.profile.*`, `openwop.family.*`),
 * explicit `req()` ids and the `openwop.floor.any.<prefix>` GROUP name no single
 * file and return null. A caller that understood only `it` ids read a per-file
 * row as an un-cited requirement and demanded a `req()` literal that, by
 * construction, never exists.
 */
export function scenarioFileOfId(requirementId: string): string | null {
  const it = scenarioFileOfItId(requirementId);
  if (it !== null) return it;
  for (const prefix of ['openwop.scenario.', 'openwop.floor.']) {
    if (!requirementId.startsWith(prefix)) continue;
    const rest = requirementId.slice(prefix.length);
    if (rest.length === 0 || rest.startsWith('any.')) return null;
    return `${rest}.test.ts`;
  }
  return null;
}

/**
 * Collision suffixing: the first occurrence keeps the bare id, later ones get
 * `~2`, `~3`, … Keyed per file so a worker running many files never crosses
 * streams. Reset per file by `setup.ts` when the file finishes.
 */
export class ItIdAllocator {
  private readonly seen = new Map<string, number>();

  allocate(scenarioFile: string, title: string): string {
    const base = itRequirementId(scenarioFile, title);
    let n = (this.seen.get(base) ?? 0) + 1;
    // An id a sibling `it` already claimed through `req()` never reached this
    // allocator, so a same-titled `it` that cites nothing must skip past it —
    // otherwise the first explicit `exists` and the derived `exists` collide.
    while (claimedExplicit.has(n === 1 ? base : `${base}~${n}`)) n++;
    this.seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  }

  reset(): void {
    this.seen.clear();
  }
}

// ---------------------------------------------------------------------------
// Explicit override for the current test.
// ---------------------------------------------------------------------------

let explicitId: string | null = null;
/** Every id handed to `req()` in this worker — consulted by `ItIdAllocator`. */
const claimedExplicit = new Set<string>();

/**
 * Attach a hand-authored requirement id to the CURRENT test. The per-`it`
 * ledger row for this test is recorded under `id` instead of the derived
 * title id. Returns the SAME message shape `driver.describe` returns —
 * `[<impl>@<version>] <section>: <requirement>` — so a failure still names
 * the implementation under test:
 *
 *   expect(x, req('openwop.auth.subject-link.leaver-deny', 'auth-profiles.md §Subject linking', 'deactivation MUST deny')).toBe(true)
 *
 * The implementation label is read straight from `OPENWOP_IMPLEMENTATION_NAME`
 * / `OPENWOP_IMPLEMENTATION_VERSION` with the defaults `env.ts` uses (`unknown`)
 * rather than through `loadEnv()`, so a suite self-test can call `req()`
 * without `OPENWOP_BASE_URL` set.
 *
 * The id MUST be listed in `conformance/requirements.json` (the generator
 * collects `req(` first-argument literals); an unlisted id fails the registry
 * check, so a hand id cannot drift from the registry silently.
 */
export function req(id: string, specSection: string, requirement: string): string {
  explicitId = id;
  claimedExplicit.add(id);
  const impl = process.env['OPENWOP_IMPLEMENTATION_NAME']?.trim() ?? 'unknown';
  const version = process.env['OPENWOP_IMPLEMENTATION_VERSION']?.trim() ?? 'unknown';
  return `[${impl}@${version}] ${specSection}: ${requirement}`;
}

/** setup.ts reads and clears the override after each test. */
export function takeExplicitRequirementId(): string | null {
  const id = explicitId;
  explicitId = null;
  return id;
}
