#!/usr/bin/env node
/**
 * Asserts every `defaultValue` on a `prompt-picker` configField in
 * `src/builder/palette/nodeCatalog.ts` matches a real `templateId` in
 * `src/prompts/samplePrompts.ts`.
 *
 * Run in CI to prevent silent dead-ref defaults when the prompt
 * library is renamed/refactored.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CATALOG_PATH = join(ROOT, 'src', 'builder', 'palette', 'nodeCatalog.ts');
const PROMPTS_PATH = join(ROOT, 'src', 'prompts', 'samplePrompts.ts');

const catalog = readFileSync(CATALOG_PATH, 'utf8');
const prompts = readFileSync(PROMPTS_PATH, 'utf8');

// Extract every templateId from the prompts file.
const promptIds = new Set(
  [...prompts.matchAll(/templateId:\s*'([^']+)'/g)].map((m) => m[1]),
);

// Find every `kind: 'prompt-picker'` block and its sibling `defaultValue: '<id>'`.
// We walk the file linearly and pair the most recent kind:'prompt-picker' with
// the next defaultValue we see, scoped to a small window.
const pairs = [];
const lines = catalog.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (!/kind:\s*'prompt-picker'/.test(lines[i])) continue;
  // Look up to 6 lines ahead for a defaultValue string.
  for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
    const m = /defaultValue:\s*'([^']+)'/.exec(lines[j]);
    if (m) {
      pairs.push({ line: j + 1, defaultValue: m[1] });
      break;
    }
    // Stop at the closing brace of the configField.
    if (lines[j].trim().startsWith('}')) break;
  }
}

const missing = pairs.filter((p) => !promptIds.has(p.defaultValue));

if (missing.length > 0) {
  console.error('check-prompt-ref-defaults FAILED:');
  for (const m of missing) {
    console.error(`  nodeCatalog.ts:${m.line} — defaultValue '${m.defaultValue}' is not a templateId in samplePrompts.ts`);
  }
  console.error('');
  console.error(`Known prompt templateIds: ${[...promptIds].sort().join(', ')}`);
  process.exit(1);
}

console.log(`check-prompt-ref-defaults OK — ${pairs.length} prompt-picker default(s) all resolve.`);
