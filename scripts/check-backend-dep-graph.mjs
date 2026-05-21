#!/usr/bin/env node
/**
 * Verify every external `import` in the workflow-engine backend's source
 * is declared in its package.json `dependencies` or `devDependencies`.
 *
 * Why this exists: backend TypeScript imports resolve against the local
 * node_modules during dev, where peer / parent packages can satisfy a
 * dep that ISN'T listed in the backend's own package.json. Cloud Run's
 * `npm ci` runs in isolation and refuses to resolve those imports —
 * ERR_MODULE_NOT_FOUND at boot, dead container. Happened with `ajv-formats`
 * on 2026-05-21 across three deploy retries before the dep boundary was
 * fixed (commit a264b3a).
 *
 * This check is the cheapest catch: AST-free regex scan over `import ...
 * from '<pkg>'` lines, normalize to the package root (`@scope/name` or
 * `name`), filter out node: builtins + relative paths, and check each
 * against the declared package.json deps. ~50ms; no node_modules walk;
 * no clean-install cost.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const BACKEND_DIR = join(REPO_ROOT, 'apps/workflow-engine/backend/typescript');
const SRC_DIR = join(BACKEND_DIR, 'src');
const PKG_JSON = join(BACKEND_DIR, 'package.json');

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/** Walk a directory recursively yielding .ts files. */
function* tsFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* tsFiles(full);
    else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) yield full;
  }
}

/** Extract external package names from `import ... from '<spec>'` lines. */
function extractImports(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const out = new Set();
  // `import X from 'spec'` / `import { X } from 'spec'` / `import 'spec'` / `import type ...`
  const re = /^\s*import\s+(?:(?:type\s+)?[^'"\n]+\s+from\s+)?['"]([^'"]+)['"];?/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1];
    // Skip relative imports + builtins
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    if (BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0])) continue;
    // Normalize to the package root: `@scope/name/subpath` → `@scope/name`,
    // `name/subpath` → `name`.
    const pkgRoot = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0];
    out.add(pkgRoot);
  }
  return out;
}

const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

const allImports = new Set();
for (const file of tsFiles(SRC_DIR)) {
  for (const imp of extractImports(file)) allImports.add(imp);
}

const missing = [...allImports].filter((p) => !declared.has(p)).sort();
if (missing.length > 0) {
  console.error(`  FAIL: backend src/ imports packages not declared in ${PKG_JSON}:`);
  for (const m of missing) console.error(`    - ${m}`);
  console.error(`  Fix: cd apps/workflow-engine/backend/typescript && npm install ${missing.join(' ')} --save`);
  console.error(`  Why this matters: Cloud Run uses npm ci in isolation; missing deps fail container boot with ERR_MODULE_NOT_FOUND.`);
  process.exit(1);
}

console.log(`  ok: ${allImports.size} backend external imports all declared in package.json`);
