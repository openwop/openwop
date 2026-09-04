#!/usr/bin/env node
/**
 * check-cut-gates — the v2 charter §F predicates as one script (RFC 0167 §F).
 *
 * "The v2.0 tag is cut when every predicate below is machine-true on the
 * release candidate. None is a header edit." This script is that sentence in
 * executable form: ten gates, each a list of existing corpus gates (scripts
 * this repo already runs) plus the two evidence reads that only a HOST bundle
 * can satisfy (Witness, Coexistence, Front door). Every gate names its
 * evidence so a reader can re-derive the verdict without trusting this file.
 *
 * Usage:
 *   node scripts/check-cut-gates.mjs --host-bundle <bundle-v3.json> [--host-discovery <doc.json>] [--network]
 *   node scripts/check-cut-gates.mjs --corpus-only        # the host gates report `blocked`
 *
 * Exit 1 when any gate fails, or when a host gate is `blocked` and
 * --corpus-only was not given. `--network` adds the npm-identity check
 * (`check-published-suite-identity.mjs --require-network`) to Identity.
 *
 * The host-tier predicates are read from a certification bundle v3
 * (schemas/v2/certification-bundle.schema.json): Witness needs at least one
 * ledger row per v2 requirement id; Coexistence needs the four named scenarios'
 * ids at `executed-pass`; Front door needs `executedFail === 0` on a host whose
 * `host.name` the INTEROP-MATRIX lists as implemented from `spec/v2/core/`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The corpus version this run is gating. A bundle measures the contract it RAN
 *  against, so evidence from another version is evidence about another contract. */
const CUT_VERSION = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'release.json'), 'utf8')).version;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const corpusOnly = flag('--corpus-only');
const network = flag('--network');
const bundlePath = opt('--host-bundle');
const discoveryPath = opt('--host-discovery');

// The four §F Coexistence scenarios, by id PREFIX: each mints one id per leg
// (`.cross-major-read`, `.prefix`, `.facet`, …), and the gate is that every leg
// of each executed and passed — not that one representative did.
const COEXISTENCE_PREFIXES = [
  'openwop.requirement.0172.dual-stack-negotiation',
  'openwop.requirement.0176.fork-a-v1-run',
  'openwop.requirement.0176.v1-signed-webhook-accepted',
  'openwop.requirement.0177.manifest-ceiling-refused',
];

function run(cmd, args, cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 900_000 });
  const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-3).join(' | ');
  return { ok: r.status === 0, evidence: `${cmd} ${args.join(' ')}`, tail };
}
const node = (script, ...args) => run('node', [join('scripts', script), ...args]);
const sh = (script, ...args) => run('bash', [join('scripts', script), ...args]);

function readJson(rel) { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); }

/**
 * The explicit requirement ids a HOST bundle can carry: those cited by a
 * `src/scenarios` file that the manifest assigns to major 2. Ids cited only by
 * `src/coherence` are corpus evidence and MUST NOT appear in a host bundle
 * (RFC 0168 §D.1), so demanding a row for them would demand the very thing the
 * disjointness rule forbids.
 */
function v2RequirementIds() {
  const majors = readJson('conformance/scenario-majors.json').majors ?? {};
  const dir = join(ROOT, 'conformance', 'src', 'scenarios');
  const ids = new Map();
  for (const [file, m] of Object.entries(majors)) {
    if (!m.includes(2)) continue;
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    // Harvest `req(` CALL SITES, not every quoted literal: a scenario's fixtures
    // carry ids as data (`v2-bundle-v3-signed` builds bundles whose rows name
    // `…fixture-a`), and no bundle can ever carry those — they are inputs to an
    // assertion, not requirements a host witnesses.
    for (const [, id] of readFileSync(path, 'utf8').matchAll(/\breq\(\s*'(openwop\.requirement\.[a-z0-9.-]+)'/g)) {
      ids.set(id, file);
    }
  }
  return ids;
}

// ── Signature attribution (RFC 0168 §E.2) ─────────────────────────────────────
// The Front-door gate used to accept `typeof signature.sig === 'string'`. That
// is satisfied by any string, so it could not tell a host key from a keypair
// minted seconds earlier by whoever wrote the bundle — which is exactly what
// both Phase 4 hosts did, and both said so. A signature nobody can attribute is
// not evidence; RFC 0168 disposed of that objection by naming `signingKeys[]`
// in the host's discovery document, so this resolves the id THERE and verifies.
const canonicalJSON = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(',')}}`;
};
const attestationPayload = (b) => Buffer.from(canonicalJSON({
  witnessSha256: b.witnessSha256, 'host.build': b.host?.build,
  'suite.version': b.suite?.version, 'discovery.sha256': b.discovery?.sha256,
}), 'utf8');
/** base64url, unpadded — the form `signingKeys[].publicKey` and `signature.sig` both use. */
const fromB64u = (x) => Buffer.from(String(x).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** Wrap a raw 32-byte Ed25519 public key in the SPKI prefix node's KeyObject wants. */
const ed25519KeyFromRaw = (raw) => createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
  format: 'der', type: 'spki',
});

function loadDiscovery() {
  if (!discoveryPath) return null;
  const p = resolve(discoveryPath);
  if (!existsSync(p)) throw new Error(`--host-discovery ${p} does not exist`);
  return { path: p, doc: JSON.parse(readFileSync(p, 'utf8')) };
}

/**
 * Four outcomes, deliberately distinct — collapsing any two is how the old
 * check went wrong:
 *   no discovery supplied      → blocked (the attribution evidence was not read)
 *   keyId not in signingKeys[] → FAIL    (read, and it does not attribute)
 *   signature does not verify  → FAIL
 *   verifies                   → ok
 */
/**
 * The bundle must have witnessed EVERY REQUIREMENT THIS CORPUS APPLIES TO IT.
 *
 * This gate exists to answer "is every §F predicate machine-true on the release
 * candidate". A bundle carries `suite.version` — the corpus it actually ran
 * against — and nothing compared it to the version being cut, so evidence from
 * an older candidate satisfied the gate silently. That is not a small gap: the
 * candidates in this program have ADDED scenarios (the era-2 writer rule, the
 * version-header check, era-stamp-universal), so a stale bundle is not merely
 * old — it never ran the checks the newer contract requires, and its clean
 * totals say nothing about them.
 *
 * Measured 2026-09-04: a bundle at `2.0.0-rc.2` passed every host gate for a
 * corpus at `2.0.0-rc.15` — thirteen candidates and nineteen corpus defects
 * later. It looked identical to evidence that was current.
 *
 * The first fix compared `suite.version` for EQUALITY, which was too strict in a
 * way a tier-2 host measured: between its `rc.8` and `rc.16` bundles, the count
 * of scenario rows added at `--target-major 1` was ZERO — every candidate in
 * that span added only `v2-*` files, which do not run against a major-1 host. So
 * the equality check rejected a bundle that had executed precisely the same
 * applicable requirement set, and charged 15 minutes plus real production runs
 * for a different signature over identical evidence.
 *
 * The property that actually matters is not "which version string" but "did this
 * bundle run everything this corpus now requires of a host at its major". That is
 * decidable from the bundle's own rows plus `scenario-majors.json`, needs no
 * checkout of the older corpus, and keeps the original guarantee in full: the
 * `rc.2`-for-`rc.15` case still fails loudly, because thirteen candidates DID add
 * applicable requirements — and now the failure names them instead of naming a
 * version. Proposed with the measurement by myndhyve-1.
 */
function suiteVersionCheck(hb) {
  const measured = hb.bundle.suite?.version;
  const major = hb.bundle.suite?.targetMajor;
  const where = `${hb.path} suite`;
  if (major !== 1 && major !== 2) {
    return { ok: false, evidence: where, tail: `suite.targetMajor is ${JSON.stringify(major)} — without it the applicable requirement set is undefined and this cannot be judged` };
  }

  // The corpus files applicable to the major this bundle measured.
  let applicable;
  try {
    const majors = JSON.parse(readFileSync(join(ROOT, 'conformance', 'scenario-majors.json'), 'utf8')).majors ?? {};
    applicable = new Set(Object.keys(majors).filter((f) => (majors[f] ?? []).includes(major)));
  } catch (e) {
    return { ok: false, evidence: 'conformance/scenario-majors.json', tail: `unreadable, so the applicable set cannot be derived: ${e.message}` };
  }

  // The files this bundle actually witnessed, read off its per-scenario rows.
  const witnessed = new Set();
  for (const row of hb.bundle.results?.requirements ?? []) {
    const m = /^openwop\.(?:scenario|floor)\.(.+)$/.exec(String(row.id));
    if (m) witnessed.add(`${m[1]}.test.ts`);
  }

  const missing = [...applicable].filter((f) => !witnessed.has(f)).sort();
  const same = measured === CUT_VERSION;
  if (missing.length === 0) {
    return {
      ok: true,
      evidence: where,
      tail: same
        ? `measured against ${CUT_VERSION}, the corpus being cut`
        : `measured against ${measured}, not ${CUT_VERSION} — but it witnessed every one of the ${applicable.size} scenario file(s) applicable at major ${major}, so nothing this corpus requires of it went unrun`,
    };
  }
  return {
    ok: false,
    evidence: where,
    tail: `the bundle measured suite ${JSON.stringify(measured)} and this corpus is ${CUT_VERSION}; ${missing.length} of ${applicable.size} scenario file(s) applicable at major ${major} have no row in it, so its totals say nothing about them: ${missing.slice(0, 6).join(', ')}. Re-certify against ${CUT_VERSION}.`,
  };
}

function signatureCheck(hb, hd) {
  const sig = hb.bundle.signature;
  const where = `${hb.path} signature`;
  if (!sig || typeof sig.sig !== 'string' || !sig.keyId) {
    return { ok: false, evidence: where, tail: 'unsigned — an unsigned v3 bundle does not exist (RFC 0168 §E.2)' };
  }
  if (!hd) {
    return { ok: false, blocked: true, evidence: '--host-discovery',
      tail: `signed by ${sig.keyId}, but no discovery document was given to resolve it against — the signature attests INTEGRITY only (the bundle was not altered after signing) and attributes to nobody` };
  }
  const keys = Array.isArray(hd.doc.signingKeys) ? hd.doc.signingKeys : [];
  const match = keys.find((k) => k && k.keyId === sig.keyId);
  if (!match) {
    return { ok: false, evidence: `${hd.path} signingKeys[]`,
      tail: keys.length === 0
        ? `the bundle is signed by ${sig.keyId} and the host publishes NO signingKeys[] — nothing binds that key to this host, so the signature is unaccountable (RFC 0168 §E.2)`
        : `the bundle is signed by ${sig.keyId}, which is not among the ${keys.length} key(s) this host publishes (${keys.map((k) => k.keyId).join(', ')})` };
  }
  let verified = false, err = '';
  try { verified = edVerify(null, attestationPayload(hb.bundle), ed25519KeyFromRaw(fromB64u(match.publicKey)), fromB64u(sig.sig)); }
  catch (e) { err = `: ${e.message}`; }
  return { ok: verified, evidence: `${hd.path} signingKeys[${sig.keyId}]`,
    tail: verified
      ? `attestation verifies under the host's published key ${sig.keyId}`
      : `the attestation does NOT verify under the host's published key ${sig.keyId}${err} — the bundle was altered after signing, or was signed by a different key` };
}

function loadBundle() {
  if (!bundlePath) return null;
  const p = resolve(bundlePath);
  if (!existsSync(p)) throw new Error(`--host-bundle ${p} does not exist`);
  const b = JSON.parse(readFileSync(p, 'utf8'));
  // The schema's discriminant is the STRING "3" (schemas/v2/certification-bundle.schema.json).
  if (String(b.bundleVersion) !== '3') throw new Error(`bundle at ${p} is bundleVersion ${JSON.stringify(b.bundleVersion)}, need "3"`);
  return { path: p, bundle: b };
}

const gates = [];
function gate(name, checks) { gates.push({ name, checks }); }
const blocked = (evidence, why) => ({ ok: false, blocked: true, evidence, tail: why });

// ── Identity ──────────────────────────────────────────────────────────────────
gate('Identity', [
  node('generate-protocol-status.mjs', '--check'),
  node('generate-from-declaration.mjs', '--check'),
  node('generate-deprecation-annotations.mjs', '--check'),
  node('generate-spec-artifacts.mjs', '--check'),
  ...(network
    ? [node('check-published-suite-identity.mjs', '--require-network'),
       node('check-published-suite-identity.mjs', '--require-network', '--package', 'spec-artifacts')]
    : [{ ok: true, evidence: 'check-published-suite-identity.mjs (skipped: no --network)', tail: 'tarball digest not compared this run' }]),
]);

// ── Registers ─────────────────────────────────────────────────────────────────
gate('Registers', [
  node('check-registers.mjs'),
  node('generate-gaps.mjs', '--check'),
  sh('check-security-invariants.sh'),
  node('check-witness-classes.mjs'),
  node('check-audit-findings.mjs'),
]);

// ── Closure ───────────────────────────────────────────────────────────────────
gate('Closure', [node('check-v2-schemas.mjs')]);

// ── Deprecation ───────────────────────────────────────────────────────────────
gate('Deprecation', [
  node('check-deprecations.mjs'),
  node('check-removal-dates.mjs'),
  node('check-alias-coverage.mjs'),
]);

// ── Paths ─────────────────────────────────────────────────────────────────────
gate('Paths', [node('check-path-parity.mjs')]);

// ── Codemods ──────────────────────────────────────────────────────────────────
gate('Codemods', [
  node('check-codemods.mjs', '--at-active'),
  existsSync(join(ROOT, 'spec-artifacts/spec/v2/event-codemap.json'))
    ? { ok: true, evidence: 'spec-artifacts/spec/v2/event-codemap.json', tail: 'event codemap ships as data in the suite peer' }
    : { ok: false, evidence: 'spec-artifacts/spec/v2/event-codemap.json', tail: 'missing from the spec-artifacts package' },
]);

// ── Waiver ────────────────────────────────────────────────────────────────────
gate('Waiver', [node('check-waiver-ledger.mjs'), node('check-waiver-authority.mjs')]);

// ── Witness / Coexistence / Front door (corpus half + host half) ──────────────
const corpusWitness = [node('check-declaration.mjs'), node('check-core-budget.mjs')];
let hb = null;
try { hb = loadBundle(); } catch (e) { corpusWitness.push({ ok: false, evidence: '--host-bundle', tail: e.message }); }
let hd = null;
try { hd = loadDiscovery(); } catch (e) { corpusWitness.push({ ok: false, evidence: '--host-discovery', tail: e.message }); }

if (!hb) {
  // A bundle that was GIVEN but could not be read is a failure, not a block —
  // silently degrading to "no bundle" would let a malformed one pass the cut.
  const loadError = corpusWitness[2];
  const why = loadError ? loadError.tail : 'no host bundle given';
  const row = loadError ? loadError : blocked('--host-bundle', `${why}: per-assertion ledger rows unread`);
  gate('Witness', [corpusWitness[0], row]);
  gate('Coexistence', [loadError ?? blocked('--host-bundle', `${why}: the four coexistence scenarios unread`)]);
  gate('Front door', [corpusWitness[1], loadError ?? blocked('--host-bundle', `${why}: 2.0.0 floor unread`)]);
} else {
  const rows = hb.bundle.results?.requirements ?? [];
  const byId = new Map();
  for (const r of rows) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  const ids = v2RequirementIds();
  // A host that honestly omits an optional family never reaches that family's
  // legs — `capabilities.md` §2 REQUIRES the omission — so its per-leg ids have
  // no rows. The file row is what carries the evidence there, and it must say
  // `inapplicable` or `blocked` WITH a reason (checked below). Anything else and
  // every id of a scenario the host actually ran must have its own row.
  const fileRow = new Map();
  for (const r of rows) if (r.scenario) fileRow.set(r.scenario, r);
  const excused = (file) => {
    const r = fileRow.get(file);
    return r !== undefined && (r.result === 'inapplicable' || r.result === 'blocked') && typeof r.detail === 'string' && r.detail.trim() !== '';
  };
  const missing = [...ids.entries()].filter(([id, file]) => !byId.has(id) && !excused(file)).map(([id]) => id);
  const nonPass = rows.filter((r) => r.result !== 'executed-pass' && !r.detail && r.result !== 'inapplicable');
  gate('Witness', [
    corpusWitness[0],
    {
      ok: missing.length === 0,
      evidence: `${hb.path} results.requirements`,
      tail: missing.length === 0
        ? `${ids.size} v2 requirement ids each carry ≥1 ledger row`
        : `${missing.length}/${ids.size} v2 requirement ids have no ledger row and no excusing file row: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`,
    },
    {
      // RFC 0168 §A.2: a soft-skip never records a pass, and every non-pass
      // states a reason. A row that is neither passing nor explained is the
      // shape the whole evidence chain exists to prevent.
      ok: nonPass.length === 0,
      evidence: `${hb.path} results.requirements[].detail`,
      tail: nonPass.length === 0 ? 'every non-pass row states a reason' : `${nonPass.length} non-pass row(s) state no reason: ${nonPass.slice(0, 3).map((r) => r.id).join(', ')}`,
    },
  ]);
  gate('Coexistence', COEXISTENCE_PREFIXES.map((prefix) => {
    const legs = rows.filter((r) => r.id === prefix || r.id.startsWith(`${prefix}.`));
    const pass = legs.length > 0 && legs.every((x) => x.result === 'executed-pass');
    const counts = legs.reduce((m, x) => ({ ...m, [x.result]: (m[x.result] ?? 0) + 1 }), {});
    return {
      ok: pass,
      evidence: `${hb.path} ${prefix}.*`,
      tail: legs.length ? `${legs.length} leg(s): ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}` : 'no row — the scenario did not run',
    };
  }));
  const suiteRow = suiteVersionCheck(hb);
  const totals = hb.bundle.results?.totals ?? {};
  const matrix = readFileSync(join(ROOT, 'INTEROP-MATRIX.md'), 'utf8');
  const hostName = hb.bundle.host?.name ?? '?';
  gate('Front door', [
    corpusWitness[1],
    suiteRow,
    { ok: totals.executedFail === 0, evidence: `${hb.path} results.totals`, tail: `executedFail=${totals.executedFail} executedPass=${totals.executedPass} blocked=${totals.blocked}` },
    { ok: matrix.includes(hostName), evidence: 'INTEROP-MATRIX.md', tail: matrix.includes(hostName) ? `row for ${hostName}` : `no row names host ${hostName}` },
    signatureCheck(hb, hd),
  ]);
}

// ── Report ────────────────────────────────────────────────────────────────────
let failed = 0, blockedCount = 0;
console.log('=== check-cut-gates — RFC 0167 §F predicates ===');
for (const g of gates) {
  const bad = g.checks.filter((c) => !c.ok);
  const isBlocked = bad.length > 0 && bad.every((c) => c.blocked);
  const verdict = bad.length === 0 ? 'PASS' : isBlocked ? 'BLOCKED' : 'FAIL';
  if (verdict === 'FAIL') failed++;
  if (verdict === 'BLOCKED') blockedCount++;
  console.log(`\n${verdict.padEnd(7)} ${g.name}`);
  for (const c of g.checks) console.log(`   ${c.ok ? 'ok ' : c.blocked ? '·· ' : 'XX '} ${c.evidence}${c.tail ? `  — ${c.tail}` : ''}`);
}
const exit = failed > 0 || (blockedCount > 0 && !corpusOnly) ? 1 : 0;
console.log(`\n=== ${failed} failed, ${blockedCount} blocked${corpusOnly ? ' (--corpus-only: blocked host gates tolerated)' : ''} → exit ${exit}`);
process.exit(exit);
