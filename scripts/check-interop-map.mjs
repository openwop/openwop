#!/usr/bin/env node
/**
 * RFC 0208 §A — `spec/v2/interop-map.json` is checked against the v2 wire it
 * maps onto. The map is normative data (spec/v2/core/interop.md §"The operation
 * mappings" incorporates every row, steward decision D7), so a row that names an
 * operation, error code, run status or facet the corpus does not define is a
 * spec defect, not a typo:
 *
 *   1. the file validates against spec/v2/interop-map.schema.json;
 *   2. every non-null `v2Operation` (a2a.operations, mcp.methods,
 *      mcp.tasks.methods) is an operationId in api/v2/openapi.yaml;
 *   3. every `a2a.errors[].clientProjection` is a code in spec/v2/errors.json;
 *   4. `$defs.runStatus.enum` equals schemas/v2/run-snapshot.schema.json
 *      `status.enum` (set equality); `a2a.taskState` (and `mcp.tasks.status`
 *      when present) carries every value exactly once as a DEFAULT row (no
 *      `interruptKind`); an override row (`interruptKind` set) exists at most
 *      once per `(runStatus, interruptKind)`;
 *   5. every `a2a.taskState[].stored` is in schemas/v2/a2a-task-state.schema.json
 *      `state.enum`;
 *   6. every `requires[]` entry `<family>.<facet>` is a property of
 *      spec/v2/facets/<family>.schema.json;
 *   7. `a2a.errors` has exactly one row for each of the nine A2A-specific errors
 *      of A2A 1.0.1 §3.3.2 (plus parenthesized non-A2A rows, e.g. invalid
 *      parameters), and no other unparenthesized row;
 *   8. every `mcp.features[].requiredFor[]` value matches
 *      spec/v2/facets/mcp.schema.json `profiles.items.pattern`;
 *   9. every `a2a.operations[].http` value (verb + path) equals the primary
 *      `google.api.http` binding of the same rpc in the vendored upstream proto
 *      (conformance/fixtures/upstream/a2a-v1.0.1/a2a.proto), path parameters
 *      compared by position (`{id=*}` ≡ `{id}` ≡ `{task_id=*}`), a compound row
 *      (`A | B | C`, verbs `X | Y | Z`, optional `[/segment]`) expanded per rpc,
 *      and every rpc that has a binding covered by some row. A row may differ
 *      from the proto only through HTTP_EXCEPTIONS, each of which names the
 *      upstream conflict it records (2.36.2, D1).
 *
 *   --map <path>   check another map file against the same corpus (the
 *                  coherence test's sabotage legs use it); default the
 *                  committed spec/v2/interop-map.json.
 *
 * Exit 0 on success, 1 on any failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const argMap = process.argv.indexOf('--map');
const mapPath = argMap > 0 ? resolve(process.argv[argMap + 1] ?? '') : join(ROOT, 'spec', 'v2', 'interop-map.json');
const failures = [];

const require = createRequire(join(ROOT, 'conformance', 'package.json'));
const { Ajv2020 } = require('ajv/dist/2020.js');
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);

const schema = read('spec/v2/interop-map.schema.json');
const map = JSON.parse(readFileSync(mapPath, 'utf8'));

// 1. schema
const validate = ajv.compile(schema);
if (!validate(map)) failures.push(`schema: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);

// 2. v2Operation ∈ api/v2/openapi.yaml operationIds
const operationIds = new Set([...readFileSync(join(ROOT, 'api', 'v2', 'openapi.yaml'), 'utf8').matchAll(/^\s*operationId:\s*([A-Za-z0-9_]+)\s*$/gm)].map((m) => m[1]));
const opRows = [
  ...(map.a2a?.operations ?? []).map((r) => ['a2a.operations', r]),
  ...(map.mcp?.methods ?? []).map((r) => ['mcp.methods', r]),
  ...(map.mcp?.tasks?.methods ?? []).map((r) => ['mcp.tasks.methods', r]),
];
for (const [group, r] of opRows) {
  if (r.v2Operation !== null && r.v2Operation !== undefined && !operationIds.has(r.v2Operation)) failures.push(`${group} ${r.upstream}${r.when ? ` (${r.when})` : ''}: v2Operation \`${r.v2Operation}\` is not an operationId in api/v2/openapi.yaml`);
}

// 3. clientProjection ∈ spec/v2/errors.json
const codes = new Set((read('spec/v2/errors.json').rows ?? []).map((e) => e.code));
for (const e of map.a2a?.errors ?? []) if (!codes.has(e.clientProjection)) failures.push(`a2a.errors ${e.upstream}: clientProjection \`${e.clientProjection}\` is not a code in spec/v2/errors.json`);

// 4. runStatus totality
const runStatuses = read('schemas/v2/run-snapshot.schema.json').properties?.status?.enum ?? [];
const declared = schema.$defs?.runStatus?.enum ?? [];
const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
if (!setEq([...new Set(declared)], [...new Set(runStatuses)])) failures.push(`$defs.runStatus.enum [${declared.join(', ')}] ≠ run-snapshot status.enum [${runStatuses.join(', ')}]`);
const totality = (group, rows) => {
  if (!Array.isArray(rows)) return;
  const defaults = new Map();
  const overrides = new Map();
  for (const r of rows) {
    if (r.interruptKind === undefined) defaults.set(r.runStatus, (defaults.get(r.runStatus) ?? 0) + 1);
    else { const k = `${r.runStatus}/${r.interruptKind}`; overrides.set(k, (overrides.get(k) ?? 0) + 1); }
  }
  for (const s of runStatuses) {
    const n = defaults.get(s) ?? 0;
    if (n !== 1) failures.push(`${group}: run status \`${s}\` has ${n} default row(s); the projection must be total — exactly one`);
  }
  for (const [k, n] of overrides) if (n > 1) failures.push(`${group}: override (${k}) appears ${n} times; at most one`);
};
totality('a2a.taskState', map.a2a?.taskState);
if (map.mcp?.tasks) totality('mcp.tasks.status', map.mcp.tasks.status);

// 5. stored ∈ a2a-task-state state.enum
const stored = read('schemas/v2/a2a-task-state.schema.json').properties?.state?.enum ?? [];
for (const r of map.a2a?.taskState ?? []) if (!stored.includes(r.stored)) failures.push(`a2a.taskState ${r.runStatus}: stored \`${r.stored}\` is not in a2a-task-state.schema.json state.enum`);

// 6. requires ∈ facet properties
for (const [group, r] of opRows) {
  for (const q of r.requires ?? []) {
    const [family, facet] = q.split('.');
    const facetPath = join(ROOT, 'spec', 'v2', 'facets', `${family}.schema.json`);
    if (!existsSync(facetPath)) { failures.push(`${group} ${r.upstream}: requires \`${q}\` names family \`${family}\`, which has no spec/v2/facets/${family}.schema.json`); continue; }
    const props = JSON.parse(readFileSync(facetPath, 'utf8')).properties ?? {};
    if (!(facet in props)) failures.push(`${group} ${r.upstream}: requires \`${q}\` — \`${facet}\` is not a property of spec/v2/facets/${family}.schema.json`);
  }
}

// 7. the nine A2A-specific errors of A2A 1.0.1 §3.3.2 (pins.a2a.spec), exactly once each
const A2A_ERRORS = [
  'TaskNotFoundError', 'TaskNotCancelableError', 'PushNotificationNotSupportedError', 'UnsupportedOperationError',
  'ContentTypeNotSupportedError', 'InvalidAgentResponseError', 'ExtendedAgentCardNotConfiguredError',
  'ExtensionSupportRequiredError', 'VersionNotSupportedError',
];
const errCount = new Map();
for (const e of map.a2a?.errors ?? []) {
  if (/^\(.*\)$/.test(e.upstream)) continue;
  if (!A2A_ERRORS.includes(e.upstream)) failures.push(`a2a.errors: \`${e.upstream}\` is not one of the nine A2A 1.0.1 §3.3.2 errors (parenthesize a non-A2A row)`);
  errCount.set(e.upstream, (errCount.get(e.upstream) ?? 0) + 1);
}
for (const n of A2A_ERRORS) if ((errCount.get(n) ?? 0) !== 1) failures.push(`a2a.errors: \`${n}\` has ${errCount.get(n) ?? 0} row(s); exactly one`);

// 8. requiredFor values match the mcp profile grammar
const profilePattern = new RegExp(read('spec/v2/facets/mcp.schema.json').properties?.profiles?.items?.pattern ?? '^$');
for (const f of map.mcp?.features ?? []) for (const p of f.requiredFor ?? []) if (!profilePattern.test(p)) failures.push(`mcp.features ${f.id}: requiredFor \`${p}\` does not match the mcp profiles pattern ${profilePattern}`);

// 9. `http` column against the vendored A2A proto
const PROTO = join(ROOT, 'conformance', 'fixtures', 'upstream', 'a2a-v1.0.1', 'a2a.proto');
// Documented disagreements between the upstream proto and the upstream prose. The row
// follows the prose; the rule text of the row says a host SHOULD accept both (RFC 0208,
// amended in place 2026-09-23).
const HTTP_EXCEPTIONS = {
  SubscribeToTask: { row: 'POST', proto: 'GET', why: 'A2A v1.0.1 proto binds GET; prose §5.3/§11.3.2 and the a2a-js/a2a-python REST clients send POST' },
};
const protoText = readFileSync(PROTO, 'utf8');
const bindings = new Map();
for (const m of protoText.matchAll(/rpc\s+(\w+)\s*\([^)]*\)\s*returns\s*\([^)]*\)\s*\{\s*option\s*\(google\.api\.http\)\s*=\s*\{\s*(get|post|put|patch|delete)\s*:\s*"([^"]+)"/g)) {
  bindings.set(m[1], { verb: m[2].toUpperCase(), path: m[3] });
}
const normPath = (p) => p.replace(/\{[^}]*\}/g, '{}');
const covered = new Set();
let compared = 0;
for (const r of map.a2a?.operations ?? []) {
  if (typeof r.http !== 'string') { failures.push(`a2a.operations ${r.upstream}: no \`http\` value to check`); continue; }
  const names = r.upstream.split('|').map((x) => x.trim());
  const sp = r.http.indexOf('/');
  const verbs = r.http.slice(0, sp).split('|').map((x) => x.trim());
  const rawPath = r.http.slice(sp).trim();
  const opt = rawPath.match(/^(.*)\[(.*)\]$/);
  const paths = opt ? [opt[1], opt[1] + opt[2]] : [rawPath];
  if (verbs.length !== names.length) { failures.push(`a2a.operations ${r.upstream}: ${names.length} upstream name(s) but ${verbs.length} verb(s) in \`${r.http}\``); continue; }
  names.forEach((name, i) => {
    const b = bindings.get(name);
    if (!b) { failures.push(`a2a.operations ${name}: the vendored proto has no google.api.http binding for this rpc`); return; }
    covered.add(name);
    const ex = HTTP_EXCEPTIONS[name];
    const verbOk = verbs[i] === b.verb || (ex && verbs[i] === ex.row && b.verb === ex.proto);
    if (!verbOk) failures.push(`a2a.operations ${name}: verb ${verbs[i]} ≠ proto ${b.verb} (${b.path})${ex ? '' : ' — no documented exception'}`);
    if (!paths.some((p) => normPath(p) === normPath(b.path))) failures.push(`a2a.operations ${name}: path \`${rawPath}\` ≠ proto \`${b.path}\``);
  });
  compared += 1;
}
for (const name of bindings.keys()) if (!covered.has(name)) failures.push(`a2a.operations: proto rpc ${name} has an HTTP binding but no row covers it`);
if (compared !== (map.a2a?.operations ?? []).length) failures.push(`a2a.operations: compared ${compared} of ${(map.a2a?.operations ?? []).length} row(s)`);
if (bindings.size === 0) failures.push(`${PROTO}: parsed no google.api.http bindings — the check would be vacuous`);
for (const name of Object.keys(HTTP_EXCEPTIONS)) if (!bindings.has(name)) failures.push(`HTTP_EXCEPTIONS names ${name}, which the proto does not bind — a stale exception`);

const label = mapPath === join(ROOT, 'spec', 'v2', 'interop-map.json') ? 'spec/v2/interop-map.json' : mapPath;
if (failures.length > 0) {
  console.error(`=== check-interop-map FAILED — ${failures.length} problem(s) in ${label} ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
const a2aRows = (map.a2a.operations.length + map.a2a.card.length + map.a2a.taskState.length + map.a2a.taskStateReverse.length + map.a2a.errors.length + map.a2a.fields.length);
const mcpRows = ['features', 'methods', 'headers', 'meta', 'mrtr', 'cache', 'authorization'].reduce((n, k) => n + (map.mcp[k]?.length ?? 0), 0);
console.log(`=== check-interop-map OK — ${label}: ${a2aRows} a2a row(s), ${mcpRows} mcp row(s); operations, error codes, run statuses and facets agree with the v2 wire; ${compared} operation row(s) match ${bindings.size} proto HTTP binding(s) ===`);
