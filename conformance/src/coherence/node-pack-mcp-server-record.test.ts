/**
 * node-pack-mcp-server-record — RFC 0203 (corpus coherence).
 *
 * A `runtime.language: "remote"` node pack MAY name its MCP server with
 * `runtime.mcpServer`, an inline subset of an MCP Registry `server.json`
 * (schema 2025-12-11): Streamable HTTP remotes only, no `packages[]`, no
 * `headers`/`variables`, no `_meta`. The subset is what keeps a signed manifest
 * free of install instructions and credential slots, so every row here is a
 * property of the manifest and needs no host.
 *
 * Runs in the corpus gate (scripts/check-spec-coherence.mjs), never in a host
 * bundle, so evidence/corpus-ledger.json carries the three requirement ids the
 * RFC's falsifiability table names.
 *
 *   mcpserver-subset      every positive fixture validates against
 *                         schemas/v2/node-pack-manifest.schema.json AND its
 *                         `mcpServer` validates against the vendored, sha256-
 *                         pinned upstream server.json schema; every subset
 *                         negative is refused; and every boundary probe our
 *                         schema accepts, the upstream schema accepts too (the
 *                         leg that keeps the field a SUBSET — widen a bound
 *                         past upstream's and a probe goes red).
 *   language-remote-only  `mcpServer` under any language other than `remote`
 *                         is refused by the schema.
 *   entry-binding         `entry` != `remotes[0].url` passes the schema (JSON
 *                         Schema cannot compare two values) and is refused by
 *                         the reference validator with `pack_validation_failed`.
 *
 * Sabotage, each run once when this file landed (RFC 0203 §Conformance): add
 * `"sse"` to the remote `type`; drop `additionalProperties: false` on the
 * remote item; relax `url` to `^https?://`; widen `description` to 200; delete
 * the `if/else`; remove the validator's equality — each turns a row red.
 *
 * @see RFCS/0203-remote-runtime-mcp-registry-record.md
 * @see spec/v2/core/node-pack-runtimes.md
 * @see conformance/fixtures.md §"fixtures/node-pack-runtime/"
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import AjvDraft07 from 'ajv';
import addFormats from 'ajv-formats';
import { FIXTURES_DIR, SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import { remoteEntryBinding } from '../lib/node-pack-runtime.js';

const SECTION = 'RFC 0203 §A; node-pack-runtimes.md §"The MCP registry record"';
const ID_SUBSET = 'openwop.requirement.0203.mcpserver-subset';
const ID_REMOTE_ONLY = 'openwop.requirement.0203.language-remote-only';
const ID_ENTRY = 'openwop.requirement.0203.entry-binding';

/** Upstream MCP Registry server.json 2025-12-11, vendored byte-for-byte. */
const UPSTREAM_URL = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const UPSTREAM_SHA256 = '3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0';

const FIX_DIR = join(FIXTURES_DIR, 'node-pack-runtime');
const UPSTREAM_PATH = join(FIX_DIR, 'upstream', 'mcp-registry-server-2025-12-11.schema.json');
const V2_SCHEMAS = join(SCHEMAS_DIR, 'v2');

type Json = Record<string, unknown>;
const readJson = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;

/** Negatives the SCHEMA refuses, by reason; each file is `negative-<reason>.json`. */
const SUBSET_NEGATIVES = [
  'sse', 'packages', 'headers', 'variables', 'http', 'templated-url',
  'two-remotes', 'version-range', 'meta', 'icons',
] as const;

function available(): string | null {
  if (V1_DIR === null) return 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';
  if (!existsSync(FIX_DIR) || !existsSync(join(V2_SCHEMAS, 'node-pack-manifest.schema.json'))) return 'inapplicable to any host: fixtures/node-pack-runtime or schemas/v2 is absent from this layout';
  return null;
}

interface Verdict { ok: boolean; errors: string; paths: string[] }

function manifestValidator(): (doc: unknown) => Verdict {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of readdirSync(V2_SCHEMAS).filter((n) => n.endsWith('.schema.json'))) {
    const s = readJson(join(V2_SCHEMAS, f));
    if (typeof s['$id'] === 'string' && ajv.getSchema(s['$id']) === undefined) ajv.addSchema(s);
  }
  const v = ajv.getSchema('https://openwop.dev/spec/v2/node-pack-manifest.schema.json');
  if (v === undefined) throw new Error('v2 node-pack-manifest schema did not register');
  return (doc) => {
    const ok = v(doc) === true;
    return { ok, errors: ajv.errorsText(v.errors), paths: (v.errors ?? []).map((e) => e.instancePath) };
  };
}

function upstreamValidator(): (doc: unknown) => { ok: boolean; errors: string } {
  const ajv = new AjvDraft07({ strict: false, allErrors: true });
  addFormats(ajv);
  const v = ajv.compile(JSON.parse(readFileSync(UPSTREAM_PATH, 'utf8')));
  return (doc) => ({ ok: v(doc) === true, errors: ajv.errorsText(v.errors) });
}

const fixture = (name: string): Json => readJson(join(FIX_DIR, `${name}.json`));
const runtimeOf = (m: Json): Json => m['runtime'] as Json;

describe('node-pack-mcp-server-record (RFC 0203, corpus)', () => {
  it('mcpServer is a subset of the MCP Registry server.json 2025-12-11 record', () => {
    const why = available();
    if (why !== null) return softSkip('inapplicable', why);

    const raw = readFileSync(UPSTREAM_PATH);
    expect(createHash('sha256').update(raw).digest('hex'), req(ID_SUBSET, SECTION, `the vendored upstream schema is byte-identical to ${UPSTREAM_URL} as pinned by RFC 0203`)).toBe(UPSTREAM_SHA256);

    const ours = manifestValidator();
    const upstream = upstreamValidator();

    const positives = readdirSync(FIX_DIR).filter((n) => n.startsWith('positive-') && n.endsWith('.json')).sort();
    expect(positives.length, req(ID_SUBSET, SECTION, 'at least the RFC positive example and an every-optional-member variant are present')).toBeGreaterThanOrEqual(2);
    for (const f of positives) {
      const m = readJson(join(FIX_DIR, f));
      const r = ours(m);
      expect(r.ok, req(ID_SUBSET, SECTION, `${f} validates against the v2 node-pack manifest schema — ${r.errors}`)).toBe(true);
      const u = upstream(runtimeOf(m)['mcpServer']);
      expect(u.ok, req(ID_SUBSET, SECTION, `${f}: its mcpServer validates against the upstream server.json schema — ${u.errors}`)).toBe(true);
    }

    for (const reason of SUBSET_NEGATIVES) {
      const r = ours(fixture(`negative-${reason}`));
      expect(r.ok, req(ID_SUBSET, SECTION, `negative-${reason}.json is refused by the v2 manifest schema (the subset excludes it)`)).toBe(false);
      // Load-bearing only if it fails for the subset and nothing else: every
      // error sits under runtime.mcpServer (or on runtime, for the if/else).
      const stray = r.paths.filter((p) => !p.startsWith('/runtime'));
      expect(stray, req(ID_SUBSET, SECTION, `negative-${reason}.json is refused only inside runtime — ${r.errors}`)).toEqual([]);
    }

    // Subset implication over boundary probes: anything our schema accepts,
    // upstream MUST accept. Each probe mutates the RFC positive at a bound the
    // two schemas share; a widening of ours past upstream's turns one red.
    const base = fixture('positive-rfc-example');
    const probes: Array<[string, (rec: Json) => void]> = [
      ['description of 101 characters', (rec) => { rec['description'] = 'd'.repeat(101); }],
      ['description of 150 characters', (rec) => { rec['description'] = 'd'.repeat(150); }],
      ['empty description', (rec) => { rec['description'] = ''; }],
      ['title of 101 characters', (rec) => { rec['title'] = 't'.repeat(101); }],
      ['name of 201 characters', (rec) => { rec['name'] = `io.example/${'n'.repeat(190)}`; }],
      ['name without a namespace slash', (rec) => { rec['name'] = 'salesforce'; }],
      ['version of 256 characters', (rec) => { rec['version'] = `1.0.0-${'a'.repeat(250)}`; }],
      ['websiteUrl that is not a URI', (rec) => { rec['websiteUrl'] = 'not a uri'; }],
      ['repository without source', (rec) => { rec['repository'] = { url: 'https://github.com/acme/x' }; }],
      ['remote url containing whitespace', (rec) => { (rec['remotes'] as Json[])[0]!['url'] = 'https://mcp.acme.example/a b'; }],
      ['remote without url', (rec) => { delete (rec['remotes'] as Json[])[0]!['url']; }],
      ['$schema of another version', (rec) => { rec['$schema'] = 'https://static.modelcontextprotocol.io/schemas/2099-01-01/server.schema.json'; }],
    ];
    for (const [label, mutate] of probes) {
      const m = structuredClone(base);
      const rec = runtimeOf(m)['mcpServer'] as Json;
      mutate(rec);
      if ('url' in ((rec['remotes'] as Json[])[0] ?? {})) runtimeOf(m)['entry'] = (rec['remotes'] as Json[])[0]!['url'];
      const o = ours(m);
      const u = upstream(rec);
      expect(!o.ok || u.ok, req(ID_SUBSET, SECTION, `probe "${label}": accepted by the v2 schema, so the upstream schema must accept it too — ${u.errors}`)).toBe(true);
    }
  });

  it('mcpServer is refused under any runtime language other than remote', () => {
    const why = available();
    if (why !== null) return softSkip('inapplicable', why);
    const ours = manifestValidator();
    const m = fixture('negative-non-remote-language');
    expect(runtimeOf(m)['language'], req(ID_REMOTE_ONLY, SECTION, 'the fixture carries mcpServer under a non-remote language')).not.toBe('remote');
    expect(ours(m).ok, req(ID_REMOTE_ONLY, SECTION, '`mcpServer` under `language: "wasm"` makes the manifest invalid')).toBe(false);
    // Control: the same runtime without mcpServer is valid, so the refusal is the rule, not the fixture.
    const control = structuredClone(m);
    delete runtimeOf(control)['mcpServer'];
    const c = ours(control);
    expect(c.ok, req(ID_REMOTE_ONLY, SECTION, `control: the same manifest without mcpServer validates — ${c.errors}`)).toBe(true);
  });

  it('entry must equal mcpServer.remotes[0].url, enforced by the manifest validator', () => {
    const why = available();
    if (why !== null) return softSkip('inapplicable', why);
    const ours = manifestValidator();
    const m = fixture('negative-entry-mismatch');
    const s = ours(m);
    expect(s.ok, req(ID_ENTRY, SECTION, `the mismatch fixture is schema-valid (JSON Schema cannot compare two values) — ${s.errors}`)).toBe(true);
    const refusal = remoteEntryBinding(m);
    expect(refusal?.code, req(ID_ENTRY, SECTION, 'entry != remotes[0].url is refused with pack_validation_failed')).toBe('pack_validation_failed');
    for (const f of readdirSync(FIX_DIR).filter((n) => n.startsWith('positive-') && n.endsWith('.json'))) {
      expect(remoteEntryBinding(readJson(join(FIX_DIR, f))), req(ID_ENTRY, SECTION, `${f}: a matching entry is not refused`)).toBeNull();
    }
  });
});
