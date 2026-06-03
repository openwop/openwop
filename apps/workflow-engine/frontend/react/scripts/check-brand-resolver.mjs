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

console.log('check-brand-resolver OK — markSrc/lockupSrc + legacy logo alias resolve correctly.');
