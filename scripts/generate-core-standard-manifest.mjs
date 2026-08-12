#!/usr/bin/env node
/**
 * RFC 0155 §B — generate `spec/v1/core-standard-manifest.json`.
 *
 * §B asks for "the exact normative spec sections, schemas, OpenAPI operations,
 * AsyncAPI messages, requirement IDs, and suite floor scenarios" that make up
 * `openwop-core-standard`, with corpus/suite provenance and a digest.
 *
 * The point is not the inventory. It is that **prose and code profile
 * definitions MUST be generated from or checked against this manifest** — so
 * the three places that currently describe the floor independently (the profile
 * prose, `PROFILE_FLOOR_SCENARIOS`, and the requirement registry) can be shown
 * to agree instead of assumed to.
 *
 * That mattered in this corpus already: `PROFILE_FLOOR_SCENARIOS` was an
 * INCOMPLETE transcription of `profiles.md`, and every profile it omitted
 * verified as floor-proven against nothing (RFC 0148 §C). A manifest with a
 * parity gate is the mechanism that would have caught it.
 *
 * Everything here is DERIVED. Nothing is hand-listed, because a hand-listed
 * manifest drifts the moment the corpus moves and then asserts the drift.
 *
 * Usage:
 *   node scripts/generate-core-standard-manifest.mjs --write
 *   node scripts/generate-core-standard-manifest.mjs --check
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'spec', 'v1', 'core-standard-manifest.json');
const PROFILE = 'openwop-core-standard';

/** Read the floor straight out of the suite's own source, not a copy of it. */
function floorFromSuite() {
  const src = readFileSync(join(ROOT, 'conformance', 'src', 'lib', 'profiles.ts'), 'utf8');
  const block = /'openwop-core-standard':\s*\{([\s\S]*?)\n  \},/.exec(src);
  if (block === null) throw new Error('could not locate the openwop-core-standard floor in profiles.ts');
  const required = [...block[1].matchAll(/'([^']+\.test\.ts)'/g)].map((m) => m[1]).sort();
  const prefixes = [...block[1].matchAll(/requiredAnyPrefix:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
    .sort();
  if (required.length === 0) throw new Error('the core-standard floor parsed as empty — refusing to emit');
  return { requiredScenarios: required, requiredAnyPrefix: prefixes };
}

/** Versioned operations in the canonical contract. */
function openapiOperations() {
  const yaml = readFileSync(join(ROOT, 'api', 'openapi.yaml'), 'utf8');
  const ids = [...yaml.matchAll(/^\s+operationId:\s*(\S+)/gm)].map((m) => m[1]).sort();
  if (ids.length === 0) throw new Error('no operationIds found in openapi.yaml — refusing to emit');
  return ids;
}

function asyncapiMessages() {
  const yaml = readFileSync(join(ROOT, 'api', 'asyncapi.yaml'), 'utf8');
  const names = [...yaml.matchAll(/^\s{4}([a-zA-Z][\w.]*):\s*$/gm)]
    .map((m) => m[1])
    .filter((n) => n.includes('.'));
  return [...new Set(names)].sort();
}

function schemaIds() {
  const dir = join(ROOT, 'schemas');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
    .map((f) => {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return { file: `schemas/${f}`, $id: s.$id ?? null };
    });
}

function requirementIds(floor) {
  return [
    ...floor.requiredScenarios.map((f) => `openwop.floor.${f.replace(/\.test\.ts$/, '')}`),
    ...floor.requiredAnyPrefix.map((p) => `openwop.floor.any.${p}`),
  ].sort();
}

function build() {
  const floor = floorFromSuite();
  const suite = JSON.parse(readFileSync(join(ROOT, 'conformance', 'package.json'), 'utf8'));
  const body = {
    profile: PROFILE,
    rfc: '0155 §B',
    provenance: {
      suite: { package: suite.name, version: suite.version },
      // Deliberately no timestamp: a generated file that changes on every run
      // cannot be parity-gated, and a digest over a moving value proves nothing.
      note: 'Derived from the corpus at generation time. Regenerate with --write; verify with --check.',
    },
    floor,
    requirementIds: requirementIds(floor),
    openapiOperations: openapiOperations(),
    asyncapiMessages: asyncapiMessages(),
    schemas: schemaIds(),
  };
  const digest = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
  return { ...body, digest };
}

const manifest = build();
const serialized = JSON.stringify(manifest, null, 2) + '\n';

if (process.argv.includes('--write')) {
  writeFileSync(OUT, serialized);
  console.log(`wrote ${OUT}`);
  console.log(
    `  ${manifest.floor.requiredScenarios.length} floor scenarios, ` +
      `${manifest.requirementIds.length} requirement ids, ` +
      `${manifest.openapiOperations.length} operations, ${manifest.schemas.length} schemas`,
  );
} else {
  if (!existsSync(OUT)) {
    console.error('core-standard-manifest.json is missing. Run with --write.');
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== serialized) {
    console.error(
      'core-standard-manifest.json is stale — the corpus moved and the manifest did not.\n' +
        'Run: node scripts/generate-core-standard-manifest.mjs --write',
    );
    process.exit(1);
  }
  console.log('core-standard-manifest.json is in sync with the corpus.');
}
