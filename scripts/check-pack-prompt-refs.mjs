#!/usr/bin/env node
/**
 * check-pack-prompt-refs — every agent `systemPromptRef` declared in a source
 * `packs/<pack>/pack.json` MUST resolve to a file that exists in the pack dir AND
 * sits where the tarball bundler (`build-pack-tarball.mjs`) will include it
 * (`prompts/*.md|.txt`). RFC 0003 §C: the referenced prompt must ship inside the
 * published tarball so an installing host can resolve it; a missing prompt is a
 * fail-loud reject.
 *
 * This is the CI-side guard (openwop:check doesn't build packs, so the build-time
 * fail-loud in build-pack-tarball.mjs isn't exercised here). It catches the defect
 * at the source: a declared prompt that's missing, or parked outside the bundled
 * `prompts/` dir, before a pack is ever published.
 *
 * Usage: node scripts/check-pack-prompt-refs.mjs
 * Exit 0 = every systemPromptRef resolves + is bundlable; exit 1 = problems listed.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = join(ROOT, 'packs');

// Mirror build-pack-tarball.mjs's bundled prompt location (prompts/*.md|.txt).
function isBundlablePromptPath(ref) {
  return /^prompts\/[^/]+\.(md|txt)$/.test(ref);
}

const problems = [];
let checked = 0;

for (const pack of readdirSync(PACKS_DIR).sort()) {
  const dir = join(PACKS_DIR, pack);
  const manifestPath = join(dir, 'pack.json');
  if (!statSync(dir).isDirectory() || !existsSync(manifestPath)) continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    problems.push(`${pack}: pack.json not valid JSON — ${err.message}`);
    continue;
  }
  for (const agent of manifest.agents ?? []) {
    const ref = agent.systemPromptRef;
    if (typeof ref !== 'string' || ref.length === 0) continue; // inline systemPrompt or none
    checked += 1;
    const id = agent.id ?? agent.agentId ?? '<agent>';
    if (!existsSync(join(dir, ref))) {
      problems.push(`${pack}: agent ${id} systemPromptRef "${ref}" — file not found in pack dir`);
    } else if (!isBundlablePromptPath(ref)) {
      problems.push(
        `${pack}: agent ${id} systemPromptRef "${ref}" — exists but is outside the bundled prompts/*.md|.txt set, so the tarball would omit it`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`✗ pack systemPromptRef bundling — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  Fix: place each agent systemPromptRef body at prompts/<name>.md in the pack dir.');
  process.exit(1);
}

console.log(`check-pack-prompt-refs OK — ${checked} agent systemPromptRef(s) resolve + are bundlable.`);
