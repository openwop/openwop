#!/usr/bin/env node
/**
 * The CHANGELOG a consumer actually receives must describe the version they
 * actually installed.
 *
 * `conformance/package.json` `files` lists `CHANGELOG.md`, which resolves
 * inside the package — so the file that ships to npm is
 * `conformance/CHANGELOG.md`, NOT the corpus `CHANGELOG.md` at the repo root.
 * Nothing checked the shipped one, and it rotted: it stopped at `1.156.0`
 * (2026-09-02) and carried ZERO mentions of any `2.0.0-rc`, while twenty-one
 * releases rc.45 … rc.65 were published on top of it. Anyone installing
 * rc.65 and reading its CHANGELOG saw a document that ended three days before
 * the v2 release series began.
 *
 * That is this corpus's recurring defect wearing another hat: a published
 * artifact making a statement that is not true of what it ships. The root
 * CHANGELOG was current the whole time, which is precisely why nobody noticed
 * — the file being edited and the file being shipped were different files with
 * the same name.
 *
 * The rule: the newest version heading in each published package's CHANGELOG
 * MUST equal that package's `version`. A release that changes nothing worth
 * recording still records that.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

for (const pkgDir of ['conformance', 'spec-artifacts']) {
  const pkgPath = join(ROOT, pkgDir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  if (!files.includes('CHANGELOG.md')) continue; // not shipped; nothing to check
  const chPath = join(ROOT, pkgDir, 'CHANGELOG.md');
  if (!existsSync(chPath)) {
    failures.push(`${pkgDir}/package.json ships CHANGELOG.md but ${pkgDir}/CHANGELOG.md does not exist — the tarball would carry no changelog at all`);
    continue;
  }
  const text = readFileSync(chPath, 'utf8');
  const m = /^##\s*\[([^\]]+)\]/m.exec(text);
  if (!m) {
    failures.push(`${pkgDir}/CHANGELOG.md has no \`## [version]\` heading — nothing states which release it describes`);
    continue;
  }
  if (m[1] !== pkg.version) {
    failures.push(
      `${pkgDir}/CHANGELOG.md's newest entry is \`${m[1]}\` but ${pkgDir}/package.json is \`${pkg.version}\` — ` +
        `the shipped changelog does not describe the shipped version. Add a \`## [${pkg.version}]\` entry. ` +
        `(This is the file that goes to npm; the corpus CHANGELOG.md at the repo root is a different file and is not packed.)`,
    );
  }
}

if (failures.length) {
  console.error('=== check-shipped-changelog FAILED ===');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('=== check-shipped-changelog OK — every packed CHANGELOG names its own package version ===');
