/**
 * Repo-path resolution that survives both the source-tree layout AND
 * the esbuild-bundled `lib/index.js` layout.
 *
 * The workflow-engine sample is built in two ways:
 *   - **Source tree** (typecheck, IDE, `tsc --noEmit`): files live at
 *     `apps/workflow-engine/backend/typescript/src/host/<file>.ts` — six
 *     levels deep from repo root.
 *   - **Bundled tree** (production `npm start`, the Cloud Run image,
 *     and the standalone host conformance runs): every backend module
 *     is collapsed into `apps/workflow-engine/backend/typescript/lib/index.js`
 *     — only four levels deep.
 *
 * Modules that read sibling-repo files (e.g., `<repo>/schemas/*`) via
 * `resolve(__dirname, '..' × 6, 'schemas')` worked under typecheck but
 * crashed under the bundled tree because `..` × 6 from `lib/` overshoots
 * two levels past the repo root. The bug surfaced 2026-05-23 — see
 * commit `d09d99c` for the original diagnosis. This module exists so
 * every subsequent path-resolution site can share one robust helper
 * instead of duplicating the buggy pattern.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Locate a sibling directory of one of the parents of `fromDir` by name,
 * verifying its identity via a sentinel file inside it. Walks parent
 * directories until `<parent>/<dirName>/<sentinelRelPath>` exists.
 *
 * @param fromDir Starting directory — typically `dirname(fileURLToPath(import.meta.url))`.
 * @param dirName Name of the directory to look for as a sibling of a parent
 *   (e.g., `'schemas'` for `<repo>/schemas`; `'conformance-fixtures'` for
 *   `<workflow-engine>/conformance-fixtures`).
 * @param sentinelRelPath A path INSIDE `dirName` that must exist for the
 *   match to be accepted. Makes the walk robust against false positives —
 *   a random `schemas/` directory somewhere in the parent chain won't
 *   match unless it contains the actual file the caller cares about.
 *   Examples:
 *     - `'ai-envelope.schema.json'` for the envelope acceptor (schemas dir)
 *     - `'prompt-pack-manifest.schema.json'` for the prompt-pack loader (schemas dir)
 *     - `'prompt-templates/conformance-prompt-writer-system.json'` for the
 *       prompt store (conformance-fixtures dir)
 * @returns Absolute path to the matched `<parent>/<dirName>` directory.
 * @throws Error when the walk terminates at the filesystem root without
 *   finding a match. Caller is expected to fail loudly at module-load
 *   (the original lazy ENOENT-at-first-request pattern is what concealed
 *   the bug for so long).
 */
export function locateRepoDir(
  fromDir: string,
  dirName: string,
  sentinelRelPath: string,
): string {
  let cur = fromDir;
  // The walk naturally terminates at the filesystem root via the
  // `parent === cur` check; no explicit depth cap needed.
  for (;;) {
    const candidate = resolve(cur, dirName);
    if (existsSync(join(candidate, sentinelRelPath))) return candidate;
    const parent = dirname(cur);
    if (parent === cur) {
      throw new Error(
        `locateRepoDir: walked from "${fromDir}" to filesystem root without finding ` +
          `a sibling "${dirName}/" directory containing "${sentinelRelPath}". ` +
          `Verify the workflow-engine is running inside the openwop repo tree.`,
      );
    }
    cur = parent;
  }
}

/**
 * Convenience wrapper for the common case — locate `<repo>/schemas/`.
 * Equivalent to `locateRepoDir(fromDir, 'schemas', sentinelFile)`.
 *
 * Pre-existing callers (envelopeAcceptor.ts, promptPackLoader.ts) use
 * this form; the generalized `locateRepoDir` is the load-bearing helper.
 */
export function locateRepoSchemasDir(fromDir: string, sentinelFile: string): string {
  return locateRepoDir(fromDir, 'schemas', sentinelFile);
}
