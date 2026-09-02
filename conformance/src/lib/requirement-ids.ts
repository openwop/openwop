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
 * Collision suffixing: the first occurrence keeps the bare id, later ones get
 * `~2`, `~3`, … Keyed per file so a worker running many files never crosses
 * streams. Reset per file by `setup.ts` when the file finishes.
 */
export class ItIdAllocator {
  private readonly seen = new Map<string, number>();

  allocate(scenarioFile: string, title: string): string {
    const base = itRequirementId(scenarioFile, title);
    const n = (this.seen.get(base) ?? 0) + 1;
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

/**
 * Attach a hand-authored requirement id to the CURRENT test. The per-`it`
 * ledger row for this test is recorded under `id` instead of the derived
 * title id. Returns the usual `driver.describe`-style message so the call
 * doubles as the assertion message:
 *
 *   expect(x, req('openwop.auth.subject-link.leaver-deny', 'auth-profiles.md §Subject linking', 'deactivation MUST deny')).toBe(true)
 *
 * The id MUST be listed in `conformance/requirements.json` (the generator
 * collects `req(` first-argument literals); an unlisted id fails the registry
 * check, so a hand id cannot drift from the registry silently.
 */
export function req(id: string, specSection: string, requirement: string): string {
  explicitId = id;
  return `${specSection}: ${requirement}`;
}

/** setup.ts reads and clears the override after each test. */
export function takeExplicitRequirementId(): string | null {
  const id = explicitId;
  explicitId = null;
  return id;
}
