#!/usr/bin/env node
/**
 * CSS custom-property integrity gate.
 *
 * Every `var(--token)` referenced anywhere in `src/` MUST resolve to a custom
 * property that is actually DEFINED somewhere in the app — either in
 * `src/styles/global.css` (`:root` or any rule) or set inline on an element
 * (`style={{ '--metric-tint': … }}`, a sanctioned dynamic-tint pattern per
 * DESIGN.app.md §10).
 *
 * Why this exists: an undefined token reference renders nothing (no fallback)
 * or silently falls back — a `var(--color-surface-alt, #f4f6f9)` that loses
 * its fallback shows a transparent box; a `var(--color-clay)` typo for the
 * real `--color-accent` drops a selection border entirely. tsc + vite happily
 * compile both. This gate catches the typo at build time instead.
 *
 * `--xy-*` vendor variables (defined by @xyflow/react's own stylesheet) are
 * exempt — they are not declared in our corpus.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** Custom properties owned by a third party (not declared in our source). */
const VENDOR_PREFIXES = ['xy-'];

const EXTS = new Set(['.ts', '.tsx', '.css']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      out.push(...walk(p));
    } else if (EXTS.has(p.slice(p.lastIndexOf('.')))) {
      out.push(p);
    }
  }
  return out;
}

const defined = new Set();
const referenced = new Map(); // token -> [{file, line}]

// A custom-property DEFINITION:
//   CSS rule:    --token: value;
//   inline (TS): '--token': value  |  "--token": value
const DEF_CSS = /(?:^|[\s;{])(--[a-z0-9-]+)\s*:/gi;
const DEF_INLINE = /['"](--[a-z0-9-]+)['"]\s*:/g;
// A REFERENCE: var(--token  [, fallback])
const REF = /var\(\s*(--[a-z0-9-]+)/g;

for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');

  // Collect definitions in both forms from every file (a .tsx may carry inline
  // `'--x':` defs; a .css carries `--x:` rule defs).
  for (const m of text.matchAll(DEF_CSS)) defined.add(m[1]);
  for (const m of text.matchAll(DEF_INLINE)) defined.add(m[1]);

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(REF)) {
      const tok = m[1];
      if (!referenced.has(tok)) referenced.set(tok, []);
      referenced.get(tok).push({ file, line: i + 1 });
    }
  }
}

const isVendor = (tok) => VENDOR_PREFIXES.some((p) => tok.startsWith(`--${p}`));

const problems = [];
for (const [tok, sites] of referenced) {
  if (defined.has(tok) || isVendor(tok)) continue;
  for (const s of sites) problems.push({ tok, ...s });
}

if (problems.length > 0) {
  console.error(`\n✗ check-css-tokens: ${problems.length} reference(s) to undefined CSS custom propert${problems.length === 1 ? 'y' : 'ies'}:\n`);
  for (const p of problems) {
    console.error(`  ${relative(ROOT, p.file)}:${p.line}  →  var(${p.tok})  (never defined in src/ or :root)`);
  }
  console.error(`\nDefine the token in src/styles/global.css :root, or fix the typo (e.g. --color-clay → --color-accent).\n`);
  process.exit(1);
}

console.log(`✓ check-css-tokens: all ${referenced.size} referenced CSS custom properties resolve.`);
