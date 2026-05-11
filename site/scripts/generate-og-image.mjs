#!/usr/bin/env node
/**
 * Render `templates/og-default.svg` → `templates/og-default.png` (1200×630).
 *
 * One-shot side-channel script. Decoupled from `src/build.mjs` so the main
 * build retains its zero-runtime-dep policy — sharp only loads when a
 * designer regenerates the OG card.
 *
 * Usage:
 *   cd site
 *   node scripts/generate-og-image.mjs
 *
 * Requires `sharp` available globally OR via a one-shot install:
 *   npx --package=sharp node scripts/generate-og-image.mjs
 *
 * The generated PNG is checked into the repo; build.mjs copies it to
 * dist/og-default.png alongside the static assets.
 *
 * To redesign the card:
 *   1. Edit templates/og-default.svg in any vector editor.
 *   2. Re-run this script.
 *   3. Commit both .svg + .png together.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');
const SVG_PATH = join(SITE_DIR, 'templates', 'og-default.svg');
const PNG_PATH = join(SITE_DIR, 'templates', 'og-default.png');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.error('[og-image] sharp is not available. Install with `npm i -g sharp` or run via `npx --package=sharp node scripts/generate-og-image.mjs`.');
  process.exit(1);
}

const svg = readFileSync(SVG_PATH);
console.log(`[og-image] reading ${SVG_PATH}`);

const png = await sharp(svg, { density: 200 })
  .resize(1200, 630, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(PNG_PATH, png);
console.log(`[og-image] wrote ${PNG_PATH} (${(png.length / 1024).toFixed(1)} KB)`);
