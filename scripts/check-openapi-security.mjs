#!/usr/bin/env node
/**
 * check-openapi-security — RFC 0200 §F: the canonical OpenAPI documents describe
 * the auth lanes the corpus defines, and every operation names the scope it enforces.
 *
 * Before RFC 0200 the two documents declared one scheme (`ApiKeyAuth`, `http`/`bearer`),
 * a single global `security: - ApiKeyAuth: []`, and no scopes at all: the per-route scope
 * vocabulary lived only in the `spec/v1/rest-endpoints.md` tables, so an A2A card's
 * `securitySchemes{}` / `securityRequirements[]` — which `a2a-integration.md` §AgentCard
 * requires to name "the auth the endpoint actually enforces" — had no generated source and
 * could only be kept by hand. This gate is what makes the document that source.
 *
 * It measures, for `api/openapi.yaml` and `api/v2/openapi.yaml`:
 *   (a) the four schemes are declared — ApiKeyAuth, OAuth2, OpenIdConnect, MutualTLS;
 *   (b) every operation declares either `security: []` (a public operation) or exactly the
 *       three alternatives ApiKeyAuth / OAuth2 / OpenIdConnect carrying IDENTICAL scope
 *       lists — inheriting the global default is a failure, because a default cannot be
 *       read as a claim about a particular operation;
 *   (c) every scope named is in `spec/v1/auth.md` §Scopes or its documented-extension
 *       table — three vocabularies (auth.md, rest-endpoints.md, the ApiKeyAuth description)
 *       had already drifted apart before this gate existed;
 *   (d) for v1, the scope list equals the `spec/v1/rest-endpoints.md` row for that method
 *       and path — the table stays the normative source and the document is its projection;
 *   (e) the shared `Unauthenticated` and `Forbidden` responses declare `WWW-Authenticate`,
 *       which is what regenerates the `spec/v2/core/headers.md` row.
 *
 * This is a CLAIMS-CHECK, not a witness (RFC 0167). It proves the corpus says a coherent
 * thing about which lanes and scopes an operation enforces; it cannot prove a host enforces
 * them. The behavioural half is `v2-auth-challenge` (the 403 scope challenge names every
 * scope the operation requires) and `auth-challenge-no-oracle`. The ledger row
 * `openwop.requirement.0200.openapi-security-declared` is minted by the coherence test
 * `conformance/src/coherence/openapi-security-declared.test.ts`, which runs this script —
 * a script alone mints nothing.
 *
 * Rule (d) is deliberately NOT applied to v2: the v2 document is generated, five of its
 * operations have no v1 ancestor (their scopes are named in `scripts/derive-v2-api.py`
 * V2_ONLY_SCOPES), and `rest-endpoints.md` is a v1 document whose paths carry the `/v1`
 * prefix v2 strips. Rules (a), (b), (c) and (e) bind both.
 *
 * Exit 0 on success, 1 on any failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ALTERNATIVES = ['ApiKeyAuth', 'OAuth2', 'OpenIdConnect'];
const REQUIRED_SCHEMES = ['ApiKeyAuth', 'OAuth2', 'OpenIdConnect', 'MutualTLS'];

/** Read an OpenAPI document through python3 + PyYAML, the same pair `derive-v2-api.py`
 *  already makes a hard dependency of the gate. A hand-rolled line reader would have to
 *  understand two different emitters: the hand-written v1 document and PyYAML's dump. */
function loadYaml(path) {
  const r = spawnSync('python3', ['-c', 'import sys,yaml,json; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)', path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    failures.push(`${path}: could not be parsed — ${String(r.stderr ?? '').trim().split('\n').slice(-3).join(' | ')}`);
    return null;
  }
  return JSON.parse(r.stdout);
}

/** The scope vocabulary: `spec/v1/auth.md` §Scopes plus its documented-extension table.
 *  Both are markdown tables whose first cell is a backticked scope. */
function scopeVocabulary() {
  const text = readFileSync(resolve(ROOT, 'spec/v1/auth.md'), 'utf8');
  const start = text.indexOf('#### Scopes');
  const end = text.indexOf('### 2. User-bearer tokens');
  if (start < 0 || end < 0 || end < start) {
    failures.push('spec/v1/auth.md: the §Scopes section boundaries moved — this gate reads the tables between "#### Scopes" and "### 2. User-bearer tokens"');
    return new Set();
  }
  const rows = [...text.slice(start, end).matchAll(/^\|\s*`([a-z][a-z:*-]*)`\s*\|/gm)].map((m) => m[1]);
  return new Set(rows);
}

/** The `spec/v1/rest-endpoints.md` scope tables, keyed `METHOD path`. A cell is `None`,
 *  one backticked scope, or the single compound form `` `runs:create` + `runs:read` ``. */
function restEndpointScopes() {
  const text = readFileSync(resolve(ROOT, 'spec/v1/rest-endpoints.md'), 'utf8');
  const map = new Map();
  for (const line of text.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const m = /^`(GET|POST|PUT|PATCH|DELETE)`$/.exec(cells[1]);
    if (!m) continue;
    const path = cells[2].replace(/^`|`$/g, '');
    const cell = cells[4];
    map.set(`${m[1]} ${path}`, cell === 'None' ? [] : cell.split('+').map((s) => s.trim().replace(/^`|`$/g, '')));
  }
  return map;
}

/** `[{ApiKeyAuth: [s]}, {OAuth2: [s]}, {OpenIdConnect: [s]}]` → the one scope list, or null. */
function alternativesScopes(security, where) {
  if (!Array.isArray(security)) {
    failures.push(`${where}: \`security\` is not an array`);
    return null;
  }
  if (security.length === 0) return []; // an explicitly public operation
  if (security.length !== ALTERNATIVES.length) {
    failures.push(`${where}: \`security\` declares ${security.length} alternative(s); RFC 0200 §F.2 requires exactly ${ALTERNATIVES.join(', ')}`);
    return null;
  }
  const seen = [];
  const lists = [];
  for (const req of security) {
    const names = Object.keys(req ?? {});
    if (names.length !== 1) {
      failures.push(`${where}: a requirement object names ${names.length} scheme(s) (${names.join(', ')}); each alternative names exactly one (a host requiring mTLS in addition adds \`MutualTLS: []\` to each object — record that as a host deployment note, not in the canonical document)`);
      return null;
    }
    seen.push(names[0]);
    lists.push(Array.isArray(req[names[0]]) ? req[names[0]].map(String) : null);
  }
  for (const want of ALTERNATIVES) {
    if (!seen.includes(want)) {
      failures.push(`${where}: \`security\` names [${seen.join(', ')}]; RFC 0200 §F.2 requires the three alternatives ${ALTERNATIVES.join(', ')}`);
      return null;
    }
  }
  const first = lists[0];
  if (first === null) {
    failures.push(`${where}: a requirement's scope value is not an array`);
    return null;
  }
  for (let i = 1; i < lists.length; i += 1) {
    if (lists[i] === null || lists[i].join(' ') !== first.join(' ')) {
      failures.push(`${where}: the alternatives carry different scope lists ([${first.join(', ')}] vs [${(lists[i] ?? []).join(', ')}]) — a caller on any lane must need the same scope, or the document describes three different APIs`);
      return null;
    }
  }
  if (first.length === 0) {
    failures.push(`${where}: the three alternatives carry empty scope lists; an operation that needs no scope is written \`security: []\``);
    return null;
  }
  return first;
}

function checkDocument(label, relPath, { enforceTable }) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) {
    failures.push(`${relPath}: does not exist`);
    return 0;
  }
  const doc = loadYaml(abs);
  if (doc === null) return 0;

  const schemes = doc?.components?.securitySchemes ?? {};
  for (const name of REQUIRED_SCHEMES) {
    if (!(name in schemes)) failures.push(`${relPath}: components.securitySchemes is missing \`${name}\` (RFC 0200 §F.1)`);
  }
  const expectType = { ApiKeyAuth: 'http', OAuth2: 'oauth2', OpenIdConnect: 'openIdConnect', MutualTLS: 'mutualTLS' };
  for (const [name, want] of Object.entries(expectType)) {
    const got = schemes?.[name]?.type;
    if (got !== undefined && got !== want) failures.push(`${relPath}: securitySchemes.${name}.type is \`${got}\`, expected \`${want}\``);
  }
  const flows = schemes?.OAuth2?.flows ?? {};
  for (const flow of ['clientCredentials', 'authorizationCode']) {
    if (!(flow in flows)) failures.push(`${relPath}: securitySchemes.OAuth2.flows is missing \`${flow}\` (RFC 0200 §F.1)`);
  }

  for (const name of ['Unauthenticated', 'Forbidden']) {
    const resp = doc?.components?.responses?.[name];
    if (resp === undefined) {
      failures.push(`${relPath}: components.responses.${name} is absent`);
      continue;
    }
    if (!(resp.headers ?? {})['WWW-Authenticate']) {
      failures.push(`${relPath}: components.responses.${name} declares no \`WWW-Authenticate\` header (RFC 0200 §B / identity.md §2.5) — the generated \`spec/v2/core/headers.md\` row is derived from it`);
    }
  }

  const vocabulary = scopeVocabulary();
  const table = enforceTable ? restEndpointScopes() : null;
  let counted = 0;
  let publicOps = 0;

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const oid = op?.operationId ?? `${method.toUpperCase()} ${path}`;
      const where = `${relPath} ${oid}`;
      counted += 1;
      if (!('security' in (op ?? {}))) {
        failures.push(`${where}: declares no \`security\`. RFC 0200 §F.2 forbids relying on the global default — an operation either names its three alternatives with the scope it enforces, or declares \`security: []\` because it is public.`);
        continue;
      }
      const scopes = alternativesScopes(op.security, where);
      if (scopes === null) continue;
      if (scopes.length === 0) {
        publicOps += 1;
        continue;
      }
      for (const s of scopes) {
        if (!vocabulary.has(s)) {
          failures.push(`${where}: scope \`${s}\` is in neither \`spec/v1/auth.md\` §Scopes nor its documented-extension table`);
        }
      }
      if (table !== null) {
        const key = `${method.toUpperCase()} ${path}`;
        const want = table.get(key);
        if (want === undefined) {
          failures.push(`${where}: no \`spec/v1/rest-endpoints.md\` row for \`${key}\``);
        } else if (want.join(' ') !== scopes.join(' ')) {
          failures.push(`${where}: declares [${scopes.join(', ')}]; \`spec/v1/rest-endpoints.md\` says [${want.join(', ') || 'None'}]`);
        }
      }
    }
  }
  console.log(`  ${label}: ${counted} operation(s), ${publicOps} public${enforceTable ? `, ${table.size} rest-endpoints row(s)` : ''}`);
  return counted;
}

const v1 = checkDocument('api/openapi.yaml', 'api/openapi.yaml', { enforceTable: true });
const v2 = checkDocument('api/v2/openapi.yaml', 'api/v2/openapi.yaml', { enforceTable: false });

if (failures.length > 0) {
  console.error(`=== check-openapi-security FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(`=== check-openapi-security OK — ${v1} v1 + ${v2} v2 operation(s) declare their lanes and scopes; WWW-Authenticate declared on both shared refusals ===`);
