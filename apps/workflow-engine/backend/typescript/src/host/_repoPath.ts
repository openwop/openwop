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
 * Locate the repo's `schemas/` directory by walking parent directories
 * until a sibling `schemas/` containing `sentinelFile` is found. Works
 * under both the source-tree layout and the esbuild-bundled tree.
 *
 * @param fromDir Starting directory — typically `dirname(fileURLToPath(import.meta.url))`.
 * @param sentinelFile A schema filename known to live in `<repo>/schemas/`.
 *   Each caller picks a sentinel its consumer must load anyway (e.g.,
 *   `ai-envelope.schema.json` for the envelope acceptor;
 *   `prompt-pack-manifest.schema.json` for the prompt-pack loader). The
 *   sentinel makes the walk robust against false positives — a random
 *   `schemas/` directory somewhere in the parent chain won't match unless
 *   it contains the actual schema file the caller cares about.
 * @returns Absolute path to the `schemas/` directory.
 * @throws Error when the walk terminates at the filesystem root without
 *   finding a matching `schemas/` directory. Caller is expected to fail
 *   loudly at module-load (the original lazy ENOENT-at-first-request
 *   pattern is what concealed the bug for so long).
 */
export function locateRepoSchemasDir(fromDir: string, sentinelFile: string): string {
  let cur = fromDir;
  // The walk naturally terminates at the filesystem root via the
  // `parent === cur` check; no explicit depth cap needed.
  for (;;) {
    const candidate = resolve(cur, 'schemas');
    if (existsSync(join(candidate, sentinelFile))) return candidate;
    const parent = dirname(cur);
    if (parent === cur) {
      throw new Error(
        `locateRepoSchemasDir: walked from "${fromDir}" to filesystem root without finding ` +
          `a sibling "schemas/" directory containing "${sentinelFile}". ` +
          `Verify the workflow-engine is running inside the openwop repo tree.`,
      );
    }
    cur = parent;
  }
}
