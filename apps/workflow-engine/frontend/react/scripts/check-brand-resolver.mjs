import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outdir = await mkdtemp(join(tmpdir(), 'openwop-brand-resolver-'));
const outfile = join(outdir, 'defaults.mjs');

const source = await readFile('src/brand/defaults.ts', 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    sourceMap: false,
  },
});
await writeFile(outfile, transpiled.outputText);

const { resolveBrandFromEnv } = await import(pathToFileURL(outfile).href);

const legacy = resolveBrandFromEnv({
  VITE_BRAND_LOGO_SRC: '/legacy-logo.svg',
  VITE_BRAND_LOCKUP_SRC: '/legacy-lockup.svg',
  VITE_BRAND_INSTANCE_NAME: 'Acme Ops',
  VITE_BRAND_DEFAULT_THEME: 'light',
  VITE_BRAND_APP_GATE_MODE: 'password',
  VITE_BRAND_APP_GATE_PASSWORD: 'secret-demo',
});
assert.equal(legacy.markSrc, '/legacy-logo.svg');
assert.equal(legacy.logoSrc, '/legacy-logo.svg');
assert.equal(legacy.lockupSrc, '/legacy-lockup.svg');
assert.equal(legacy.instanceName, 'Acme Ops');
assert.equal(legacy.defaultTheme, 'light');
assert.deepEqual(legacy.appGate, { mode: 'password', password: 'secret-demo' });

const current = resolveBrandFromEnv({
  VITE_BRAND_MARK_SRC: '/mark.svg',
  VITE_BRAND_LOGO_SRC: '/legacy-logo.svg',
});
assert.equal(current.markSrc, '/mark.svg');
assert.equal(current.logoSrc, '/mark.svg');

const blank = resolveBrandFromEnv({
  VITE_BRAND_MARK_SRC: '  ',
  VITE_BRAND_LOGO_SRC: '/legacy-logo.svg',
  VITE_BRAND_DEFAULT_THEME: 'sepia',
  VITE_BRAND_APP_GATE_MODE: 'weird',
});
assert.equal(blank.markSrc, '/legacy-logo.svg');
assert.equal(blank.defaultTheme, 'system');
assert.equal(blank.appGate.mode, 'none');

await rm(outdir, { recursive: true, force: true });

// ── Brand-mark drift guard ──────────────────────────────────────────────────
// The OpenWOP mark exists in several places by design: the served asset
// `public/OpenWOP.svg` (plus repo-level mirrors in `public/assets/` and
// `registry/assets/`, identical bytes) and the inline `currentColor` variant
// in `src/brand/OpenwopLogo.tsx` (different theming, same geometry). Guard
// both relationships so an edit to one copy can't silently drift the others.
const { existsSync, readFileSync } = await import('node:fs');

// (a) The three committed .svg copies must stay byte-identical. The repo-level
// mirrors don't exist in the standalone white-label zip — skip silently there.
const canonicalSvgPath = 'public/OpenWOP.svg';
const canonicalSvg = readFileSync(canonicalSvgPath, 'utf8');
for (const mirror of [
  '../../../../public/assets/OpenWOP.svg',
  '../../../../registry/assets/OpenWOP.svg',
]) {
  if (!existsSync(mirror)) continue;
  assert.equal(
    readFileSync(mirror, 'utf8'),
    canonicalSvg,
    `brand-mark drift: ${mirror} differs from ${canonicalSvgPath} — keep all committed OpenWOP.svg copies byte-identical`,
  );
}

// (b) The inline OpenwopLogo.tsx mark must keep the same geometry (the set of
// path `d=` attributes) as the served asset — only fill/stroke theming differs.
const pathData = (svg) => new Set([...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]));
const logoTsx = readFileSync('src/brand/OpenwopLogo.tsx', 'utf8');
const inlineMark = logoTsx.match(/const OPENWOP_MARK = `([^`]+)`/)?.[1];
assert.ok(inlineMark, 'OpenwopLogo.tsx: OPENWOP_MARK template literal not found');
assert.deepEqual(
  [...pathData(inlineMark)].sort(),
  [...pathData(canonicalSvg)].sort(),
  'brand-mark drift: OpenwopLogo.tsx inline geometry differs from public/OpenWOP.svg — update both together',
);

console.log('check-brand-resolver OK — markSrc/lockupSrc + legacy logo alias resolve correctly; brand-mark copies in sync.');
