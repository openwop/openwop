#!/usr/bin/env node
/**
 * Render `public/assets/og-cover.svg` → `public/assets/og-cover.png` (1200×630).
 *
 * Companion to `site/scripts/generate-og-image.mjs` — same one-shot pattern but
 * for the marketing-site OG card under `public/assets/`. Decoupled from the
 * Firebase deploy so sharp only loads when a designer regenerates the card.
 *
 * Usage:
 *   npx --yes --package=sharp -- node scripts/generate-og-cover.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SVG_PATH = join(ROOT, 'public', 'assets', 'og-cover.svg');
const PNG_PATH = join(ROOT, 'public', 'assets', 'og-cover.png');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('[og-cover] sharp is not available. Run via `npx --yes --package=sharp -- node scripts/generate-og-cover.mjs`.');
  process.exit(1);
}

const svg = readFileSync(SVG_PATH);
console.log(`[og-cover] reading ${SVG_PATH}`);

const png = await sharp(svg, { density: 200 })
  .resize(1200, 630, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(PNG_PATH, png);
console.log(`[og-cover] wrote ${PNG_PATH} (${(png.length / 1024).toFixed(1)} KB)`);
