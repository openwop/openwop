#!/usr/bin/env node
/**
 * Built-CSS integrity gate — runs AFTER `vite build`, against `dist/assets/*.css`.
 *
 * Asserts the bundled stylesheet contains ZERO empty `:is()` selectors. An
 * empty `:is()` is the unambiguous fingerprint of a local CSS nesting break:
 * an unclosed `{` in `src/styles/global.css` makes esbuild's nesting transform
 * swallow every following rule as a *child* and lower the (empty) parent to
 * `:is()`, which matches nothing — so every swallowed rule silently vanishes
 * at runtime (no error, no failed build).
 *
 * Why this exists, and why neither tsc, vite, nor the source-side
 * `check-css-tokens` gate catches it:
 *   - The empty `:is()` is PRODUCED by the vite/esbuild build, so it exists
 *     only in the BUILT bundle — a source scan can't see it.
 *   - A global brace count on the source is ALSO insufficient: two defects
 *     (one missing `}` + one stray `}`) cancel to depth 0 and pass a brace
 *     check while the file is locally broken. That exact pattern shipped past
 *     a brace-only fix and broke /keys (provider badges), then the builder
 *     minimap, then the account menu — one screenshot at a time.
 * The built-bundle `:is()` count is the reliable signal.
 *
 * When this trips: the FIRST swallowed selector printed below names the first
 * dropped rule. Walk UP from it in `global.css` to the nearest rule missing
 * its `}` and restore that rule (recover it verbatim from the pre-break
 * commit, e.g. `git show <good-sha>:.../global.css`). NEVER "fix" the
 * stylesheet with a broad `re.sub`/regex delete over the whole file — a
 * count=0 regex deleting `background:` + `}` is what dropped the rules.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist', 'assets');

let cssFiles;
try {
  cssFiles = readdirSync(DIST).filter((f) => f.endsWith('.css'));
} catch {
  console.error('\n✗ check-built-css: dist/assets not found — run `vite build` first.\n');
  process.exit(1);
}
if (cssFiles.length === 0) {
  console.error('\n✗ check-built-css: no built CSS in dist/assets — run `vite build` first.\n');
  process.exit(1);
}

// Match an EMPTY `:is()` (no arguments) plus the selector that follows it, so
// the failure message can name the first swallowed rule. A legitimate
// `:is(.a, .b)` carries arguments and is never matched by `:is()`.
const EMPTY_IS = /:is\(\)\s*([^{,;]*)/g;

let total = 0;
const samples = [];
for (const f of cssFiles) {
  const css = readFileSync(join(DIST, f), 'utf8');
  for (const m of css.matchAll(EMPTY_IS)) {
    total++;
    if (samples.length < 5) {
      const sel = m[1].trim();
      samples.push(`${f}  →  :is()${sel ? ' ' + sel : ''}`);
    }
  }
}

if (total > 0) {
  console.error(
    `\n✗ check-built-css: ${total} empty \`:is()\` selector(s) in the built CSS.\n` +
      `  A rule block was swallowed by an unclosed \`{\` in src/styles/global.css.\n`,
  );
  for (const s of samples) console.error(`  first swallowed: ${s}`);
  console.error(
    `\nFix: walk UP from the first selector above in src/styles/global.css to the\n` +
      `nearest rule missing its \`}\` and restore it (recover verbatim from the\n` +
      `pre-break commit). Do NOT delete CSS with a broad regex.\n`,
  );
  process.exit(1);
}

console.log('✓ check-built-css: 0 empty :is() in the built CSS (no swallowed rules).');
