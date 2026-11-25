#!/usr/bin/env node
/**
 * RFC 0155 §B — `spec/v1/core-standard-manifest.json`, FROZEN by RFC 0266 §C.
 *
 * The manifest lists the v1 `openwop-core-standard` floor: v1 OpenAPI
 * operations, AsyncAPI messages, flat v1 schemas and the v1 floor scenarios.
 * Until 2.49.12 every release regenerated it (its provenance carries the suite
 * version), which made it a live generated file inside the frozen v1 tree. It
 * is now history: this script never writes it. The v2 profile floors are
 * `spec/v2/profiles.json`, generated from `spec/v2/declaration.json` by
 * `generate-from-declaration.mjs`.
 *
 *   --check   the frozen file exists and its `digest` still matches its body
 *   --write   refused — nothing regenerates a file in spec/v1/
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'spec', 'v1', 'core-standard-manifest.json');

if (process.argv.includes('--write')) {
  console.error('generate-core-standard-manifest: refused — spec/v1/core-standard-manifest.json is frozen (RFC 0266 §C). The v2 profile floors are spec/v2/profiles.json.');
  process.exit(1);
}
if (!existsSync(OUT)) {
  console.error('generate-core-standard-manifest: spec/v1/core-standard-manifest.json is missing — it is frozen history; restore it from git.');
  process.exit(1);
}
const { digest, ...body } = JSON.parse(readFileSync(OUT, 'utf8'));
if (createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex') !== digest) {
  console.error('generate-core-standard-manifest: spec/v1/core-standard-manifest.json no longer matches its own digest — the frozen file was edited; restore it from git.');
  process.exit(1);
}
console.log('core-standard-manifest.json is frozen (RFC 0266 §C) and matches its digest.');
