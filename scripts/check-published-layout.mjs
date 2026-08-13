#!/usr/bin/env node
/**
 * check-published-layout — collect every conformance scenario in the layout
 * that actually ships, not the one we develop in.
 *
 * ## Why this exists
 *
 * The suite runs in two layouts. In a repo checkout, `spec/v1/`, `RFCS/`, and
 * `docs/` sit above the conformance package. In the published tarball they do
 * not: `api/` and `schemas/` are vendored in, prose is not bundled at all, and
 * `paths.ts` reports `V1_DIR === null` to say so.
 *
 * Every gate we had ran in the first layout. So a scenario could resolve a
 * schema through `V1_DIR/../..`, cast the null away with `as string`, pass
 * every check, ship — and throw at import for anyone installing from npm. That
 * is not hypothetical: **six scenarios did exactly that**, and the failure was
 * found by pointing a published tarball at a live host rather than by any gate.
 *
 * A collection error is the worst shape for this to take. It takes down the
 * whole file, not one leg, so a consumer loses every assertion in it at once —
 * and because the file never loaded, nothing reports which requirements went
 * unverified. RFC 0148 §A resolves an unwitnessed requirement to `blocked`
 * rather than to a pass; a file that failed to load reports neither.
 *
 * ## What it does
 *
 * Packs the conformance package (running the real `prepack` vendoring), unpacks
 * it somewhere with no repo above it, and asks vitest to COLLECT every scenario.
 * Collection alone is the point — it exercises module-scope and `describe`
 * factory bodies, which is where layout-dependent reads live. `describe.skipIf`
 * does not help there: vitest still runs the factory and only then decides to
 * skip what it collected.
 *
 * ## The floor
 *
 * A collector that finds nothing exits 0. Green over an empty set is the
 * failure this whole program is about, so the discovered-test count is asserted
 * against a floor — this gate refuses to pass by having done nothing.
 *
 * Usage: node scripts/check-published-layout.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFORMANCE = join(ROOT, 'conformance');

/**
 * Below this, assume the collection did not really happen. The suite carries
 * thousands of tests across 400+ files; a run reporting a handful means the
 * extract or the config resolution broke, and passing on that would be the
 * vacuous green this gate exists to prevent.
 */
const MIN_TESTS = 1500;
const MIN_FILES = 300;

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

console.log('=== check-published-layout — collecting scenarios in the PUBLISHED tarball layout ===\n');

let work = null;
try {
  // 1. Pack. This runs the real prepack, so the vendored api/ + schemas/ and the
  //    CORPUS-STAMP are exactly what a consumer would install.
  console.log('  packing @openwop/openwop-conformance...');
  const packOut = run('npm', ['pack', '--silent'], CONFORMANCE).trim().split('\n');
  const tarball = packOut[packOut.length - 1].trim();
  const tarballPath = join(CONFORMANCE, tarball);
  if (!existsSync(tarballPath)) throw new Error(`npm pack produced no tarball (said: ${tarball})`);

  try {
    // 2. Unpack into a temp dir — deliberately NOT under the repo, so nothing
    //    can accidentally resolve upward into the corpus and mask the bug.
    work = mkdtempSync(join(tmpdir(), 'openwop-published-'));
    run('tar', ['xzf', tarballPath, '-C', work], work);
    const pkg = join(work, 'package');
    if (!existsSync(pkg)) throw new Error('tarball did not contain package/');

    // 3. Borrow the already-installed dependency tree rather than reinstalling.
    //    The symlink lives in a temp dir outside git, so it cannot leave a stray
    //    link behind in a worktree.
    symlinkSync(join(CONFORMANCE, 'node_modules'), join(pkg, 'node_modules'), 'dir');

    // 4. Collect. Any module-scope or describe-factory read that assumed the
    //    repo layout throws here.
    console.log('  collecting every scenario (vitest list)...\n');
    let listed;
    try {
      listed = run('node', [join(CONFORMANCE, 'node_modules', 'vitest', 'vitest.mjs'), 'list'], pkg);
    } catch (err) {
      const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      throw new Error(
        'collection FAILED in the published layout — a scenario reads a path that only exists in a ' +
          'repo checkout. Resolve schemas through `SCHEMAS_DIR` (vendored into the package, non-null ' +
          'in both layouts); guard prose reads on a nullable dir and keep them out of `describe` ' +
          `factory bodies.\n\n${detail.slice(-3000)}`,
      );
    }

    const lines = listed.split('\n').filter((l) => l.trim().length > 0);
    const files = new Set(lines.map((l) => l.split(' > ')[0].trim()).filter((f) => f.endsWith('.ts')));
    console.log(`  collected ${lines.length} tests across ${files.size} files`);

    if (lines.length < MIN_TESTS || files.size < MIN_FILES) {
      throw new Error(
        `collected ${lines.length} tests / ${files.size} files, below the floor of ${MIN_TESTS}/${MIN_FILES}. ` +
          'A collector that finds nothing exits 0, so this gate asserts it actually looked.',
      );
    }

    // 5. The vendored contract material must be present, or every schema leg
    //    would skip while the run still reported success.
    for (const dir of ['schemas', 'api', 'fixtures', 'vectors']) {
      if (!existsSync(join(pkg, dir)) || readdirSync(join(pkg, dir)).length === 0) {
        throw new Error(`published tarball is missing ${dir}/ — add it to package.json "files"`);
      }
    }
    console.log('  vendored schemas/ api/ fixtures/ vectors/ all present');
  } finally {
    rmSync(tarballPath, { force: true });
  }

  console.log('\n=== check-published-layout OK — every scenario collects where it ships ===');
} catch (err) {
  console.error(`\ncheck-published-layout FAILED\n\n${err.message}`);
  process.exit(1);
} finally {
  if (work !== null) rmSync(work, { recursive: true, force: true });
}
