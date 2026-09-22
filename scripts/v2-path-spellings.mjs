/**
 * The one `/v1/<op>` → `/<op>` rule both v2 seeders apply to v1 prose
 * (generate-from-declaration.mjs for the capabilities facets,
 * derive-v2-schemas.mjs for the copied wire schemas).
 *
 * Seeded descriptions are v1 prose and spell operations as `/v1/<op>`. Under
 * major 2 a manifest-named operation is addressed by its unversioned key
 * (versioning.md §1.2), so those spellings are rewritten at seed time — ONLY
 * where `<op>` matches an operation or channel template in
 * spec/v2/path-manifest.json. A `/v1/` spelling the manifest does not name
 * (host-sample seams, packs-test, workspace files, `spec/v1/*.md` citations)
 * is left exactly as written: rewriting it would invent a path no v2 host
 * serves. Errata 2026-09-10 (#1317): `prompts.renderEndpoint` shipped in the v2
 * schema saying "Defaults to `/v1/prompts:render`", and a host advertised
 * exactly that. One module so the two seeders cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'path-manifest.json'), 'utf8'));
const MANIFEST_TEMPLATES = [...new Set([...MANIFEST.operations.map((o) => o.path), ...MANIFEST.channels.map((c) => c.address)])]
  .filter((p) => p !== '/.well-known/openwop' && p !== '/openapi.json')
  .sort((a, b) => b.length - a.length)
  .map((t) => new RegExp('^' + t.split('/').slice(1).map((s) => (s.startsWith('{') ? '(?:\\{[A-Za-z]+\\}|[A-Za-z0-9._~-]+)' : s.replace(/[.:]/g, '\\$&'))).join('/') + '(?=$|[^A-Za-z0-9._~{}/-])'));

export function unversionManifestSpellings(text) {
  return text.replace(/\/v1\/([^\s"'`)\]>,\\]*)/g, (whole, rest) => (MANIFEST_TEMPLATES.some((re) => re.test(rest)) ? `/${rest}` : whole));
}
