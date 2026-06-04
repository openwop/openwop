#!/usr/bin/env node
/**
 * No-raw-color-literal lint for TSX/TS (white-label PRD §6).
 *
 * Colors live in the governed token system (`global.css` custom properties +
 * `brand.css` overrides) so a white-label fork re-themes by editing tokens,
 * never component code. A hex/oklch/rgb literal inside TSX silently escapes
 * that system — it won't follow dark mode, brand overrides, or a fork's
 * palette. This gate fails the build on any new literal.
 *
 * Sanctioned exceptions (the allowlist below):
 *   - `brand/OpenwopLogo.tsx` — the committed brand SVG markup (its clay
 *     accent is intentionally literal; geometry is guarded by
 *     check-brand-resolver.mjs),
 *   - `brand/defaults.ts` — brand DEFAULT values are the token source
 *     (`themeColor` etc.), overridden per fork via VITE_BRAND_*,
 *   - `ui/icons/` — icon components own their stroke conventions.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');

const ALLOWLIST = [
  'brand/OpenwopLogo.tsx',
  'brand/defaults.ts',
  'ui/icons/',
];

// Hex colors (#abc / #aabbcc / #aabbccdd) and functional color literals.
// `var(--token)` references and CSS files are out of scope (the css-token
// gate owns those); this scans only .ts/.tsx component code.
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgba?\(|\bhsla?\(/g;

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.d.ts')) continue;
    const rel = relative(SRC, p).replaceAll('\\', '/');
    if (ALLOWLIST.some((a) => rel === a || rel.startsWith(a))) continue;
    const source = readFileSync(p, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, i) => {
      // Skip comments — prose may legitimately name a color.
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      const hits = code.match(COLOR_RE);
      if (hits) offenders.push(`${rel}:${i + 1} → ${hits.join(', ')}`);
    });
  }
}
walk(SRC);

if (offenders.length > 0) {
  console.error(`check-tsx-color-literals FAIL — ${offenders.length} raw color literal(s) in component code.`);
  console.error('Move the color into a token (global.css :root / brand.css) and reference var(--token):');
  for (const o of offenders) console.error(`  ✗ ${o}`);
  process.exit(1);
}
console.log('check-tsx-color-literals OK — no raw color literals outside the sanctioned brand/icon files.');
