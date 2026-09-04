#!/usr/bin/env node
/**
 * `openwop-conformance` — operator-facing CLI for running the openwop
 * conformance suite against a deployed server.
 *
 * Wraps `vitest` with friendlier args + structured exit codes so it
 * works as the `npm test` entry for downstream packages.
 *
 * Usage:
 *   openwop-conformance --base-url https://api.example.com --api-key hk_test_123
 *   openwop-conformance --offline                       # server-free subset only
 *   openwop-conformance --filter discovery               # category filter
 *   openwop-conformance --base-url ... --api-key ... --filter "interrupt|cancellation"
 *   openwop-conformance --base-url ... --api-key ... --certify out.json   # RFC 0089 bundle
 *   openwop-conformance --base-url ... --api-key ... --max-workers 4    # cap parallel scenario files
 *
 * Environment variables override flags (per the conformance harness's
 * existing convention):
 *   OPENWOP_BASE_URL, OPENWOP_API_KEY, OPENWOP_IMPLEMENTATION_NAME,
 *   OPENWOP_IMPLEMENTATION_VERSION, OPENWOP_LIFECYCLE_TIMEOUT_MS,
 *   OPENWOP_POLL_TIMEOUT_SCALE, OPENWOP_MAX_WORKERS
 *
 * OPENWOP_LIFECYCLE_TIMEOUT_MS sets the DEFAULT poll bound only — it does
 * not reach the many scenarios that pass an explicit `timeoutMs`.
 * OPENWOP_POLL_TIMEOUT_SCALE (default 1) multiplies EVERY bound and is the
 * knob to reach for when a run's failures are the endpoint (cold start,
 * contention) rather than the host. See src/lib/polling.ts.
 *
 * Exit codes:
 *   0   all scenarios pass
 *   1   one or more scenarios failed
 *   2   suite couldn't start (missing required args, etc)
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from './lib/paths.js';
import { readLedgerFile } from './lib/requirement-ledger.js';
import { deriveRequirementDispositions } from './lib/scenario-disposition.js';
import { scrubEvidence, evidenceSecretsFromEnv, verifyBundleV2 } from './lib/certification-bundle-verify.js';
import { publicKeyFromPrivate, signBundleV3, verifierSign, verifyBundleV3, witnessDigest, type BundleV3, type BundleV3Requirement } from './lib/certification-bundle-v3.js';
import {
  deriveProfiles,
  isCoreStandard,
  agentPlatformStatus,
  DEPRECATED_PROFILE_ALIASES,
  type DiscoveryPayload,
  PROFILE_FLOOR_SCENARIOS,
} from './lib/profiles.js';

interface ParsedArgs {
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly offline: boolean;
  readonly filter: string | undefined;
  /** Suite 2.0.0 (RFC 0168 §D.3): which protocol major's scenarios run. Default: the host's preferredVersion, else max(protocolVersions[]), else 1. */
  readonly targetMajor: 1 | 2 | undefined;
  readonly help: boolean;
  readonly impl: string | undefined;
  readonly implVersion: string | undefined;
  /** RFC 0089 — emit a conformance certification bundle to this path. */
  readonly certify: string | undefined;
  readonly bundleVersion: '2' | '3';
  /** Suite 2.0.0 (RFC 0168 §E): v3 needs the build identity, the signing key, and the tier. */
  readonly hostBuild: { kind: 'image-digest' | 'commit' | 'artifact-sha256'; id: string } | undefined;
  readonly evidenceTier: 'self' | 'steward' | 'independent';
  readonly signingKeyPath: string | undefined;
  readonly signingKeyId: string | undefined;
  readonly verifierKeyPath: string | undefined;
  readonly verifierKeyId: string | undefined;
  /**
   * S43 (2026-08-18) — cap on concurrently running scenario FILES, forwarded to
   * vitest `--maxWorkers`. Unset = vitest's default (one worker per CPU), which
   * hammers a rate-limited production origin with ~460 files at once and turns
   * `429`s into spurious reds. Env: `OPENWOP_MAX_WORKERS`.
   */
  readonly maxWorkers: number | undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let baseUrl: string | undefined;
  let apiKey: string | undefined;
  let offline = false;
  let filter: string | undefined;
  let help = false;
  let impl: string | undefined;
  let implVersion: string | undefined;
  let certify: string | undefined;
  // Suite 1.152.0: bundle v2 (RFC 0148) is the default. v1 stays reachable via
  // `--bundle-version 1` through the RFC 0148 migration window (ends
  // 2026-11-10) and is removed at v2.0 (spec/v1/deprecations.json).
  let bundleVersion: '2' | '3' = '3';
  let hostBuild: ParsedArgs['hostBuild'];
  let evidenceTier: ParsedArgs['evidenceTier'] = 'self';
  let signingKeyPath: string | undefined, signingKeyId: string | undefined, verifierKeyPath: string | undefined, verifierKeyId: string | undefined;
  let targetMajor: 1 | 2 | undefined;
  let maxWorkers: number | undefined = parseMaxWorkers(process.env.OPENWOP_MAX_WORKERS, 'OPENWOP_MAX_WORKERS');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--offline') {
      offline = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    const nextValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        i++;
        return next;
      }
      return undefined;
    };

    switch (flag) {
      case '--base-url':
        baseUrl = nextValue();
        break;
      case '--api-key':
        apiKey = nextValue();
        break;
      case '--target-major': {
        const v = argv[++i];
        if (v !== '1' && v !== '2') { process.stderr.write(`openwop-conformance: --target-major must be 1 or 2 (got ${String(v)})\n`); process.exit(2); }
        targetMajor = v === '2' ? 2 : 1;
        break;
      }
      case '--filter':
        filter = nextValue();
        break;
      case '--impl':
      case '--implementation-name':
        impl = nextValue();
        break;
      case '--impl-version':
      case '--implementation-version':
        implVersion = nextValue();
        break;
      case '--bundle-version': {
        const v = argv[++i];
        if (v !== '2' && v !== '3') { process.stderr.write(`openwop-conformance: --bundle-version must be 2 or 3 (got ${String(v)}); v1 is gone in suite 2.0.0 (RFC 0168 §E.3)\n`); process.exit(2); }
        if (v === '2') process.stderr.write('openwop-conformance: --bundle-version 2 is DEPRECATED — v2 bundles stop substantiating a certification at v1 end-of-support (RFC 0168 §E.3); the default is 3.\n');
        bundleVersion = v;
        break;
      }
      case '--host-build': {
        const v = argv[++i] ?? '';
        const mm = /^(image-digest|commit|artifact-sha256):(.+)$/.exec(v);
        if (!mm) { process.stderr.write(`openwop-conformance: --host-build must be <image-digest|commit|artifact-sha256>:<id> (got ${JSON.stringify(v)})\n`); process.exit(2); }
        hostBuild = { kind: mm[1] as 'image-digest' | 'commit' | 'artifact-sha256', id: mm[2] };
        break;
      }
      case '--evidence-tier': {
        const v = argv[++i];
        if (v !== 'self' && v !== 'steward' && v !== 'independent') { process.stderr.write('openwop-conformance: --evidence-tier must be self, steward or independent\n'); process.exit(2); }
        evidenceTier = v;
        break;
      }
      case '--signing-key': signingKeyPath = argv[++i]; break;
      case '--signing-key-id': signingKeyId = argv[++i]; break;
      case '--verifier-key': verifierKeyPath = argv[++i]; break;
      case '--verifier-key-id': verifierKeyId = argv[++i]; break;
      case '--certify':
        certify = nextValue();
        break;
      case '--max-workers':
        maxWorkers = parseMaxWorkers(nextValue(), '--max-workers');
        break;
      default:
        if (arg.startsWith('-')) {
          // Unknown flag — pass through to vitest by ignoring here.
        }
    }
  }

  return {
    baseUrl,
    apiKey,
    offline,
    filter,
    help,
    impl,
    implVersion,
    certify,
    bundleVersion,
    targetMajor,
    hostBuild,
    evidenceTier,
    signingKeyPath,
    signingKeyId,
    verifierKeyPath,
    verifierKeyId,
    maxWorkers,
  };
}

/** Parse a `--max-workers` / `OPENWOP_MAX_WORKERS` value: a positive integer, else exit 2. */
function parseMaxWorkers(raw: string | undefined, source: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(`${source} must be a positive integer (got '${raw}')\n`);
    process.exit(2);
  }
  return n;
}

/** The vitest argv fragment for the resolved worker cap (empty when uncapped). */
function maxWorkersArgs(maxWorkers: number | undefined): string[] {
  return maxWorkers === undefined ? [] : ['--maxWorkers', String(maxWorkers)];
}

const HELP_TEXT = `openwop-conformance — run the openwop conformance suite against a server

Usage:
  openwop-conformance [options]

Required (unless --offline):
  --base-url <url>      openwop server base URL (or set OPENWOP_BASE_URL env var)
  --api-key <key>       Bearer-style API key (or set OPENWOP_API_KEY env var)

Filtering:
  --offline             Run only the declared server-free subset (fixtures-valid; see README §"--offline")
  --filter <pattern>    Pass through to vitest --testNamePattern

Implementation labels (cosmetic — surface in failure messages):
  --impl <name>             Implementation name        (env: OPENWOP_IMPLEMENTATION_NAME)
  --impl-version <version>  Implementation version     (env: OPENWOP_IMPLEMENTATION_VERSION)

Certification (RFC 0089):
  --target-major <1|2>    Suite 2.0.0 (RFC 0168 §D.3): run the scenarios for this protocol
                          major. Default: the host's preferredVersion (RFC 0179), else
                          max(protocolVersions[]), else 1. Selection is scenario-majors.json.
  --host-build <k>:<id>   v3: the build identity (image-digest|commit|artifact-sha256), or OPENWOP_HOST_BUILD.
  --signing-key <pem>     v3: Ed25519 private key (PKCS8 PEM) that signs the bundle, or OPENWOP_BUNDLE_SIGNING_KEY.
  --signing-key-id <id>   v3: the keyId the host publishes for that key, or OPENWOP_BUNDLE_SIGNING_KEY_ID.
  --evidence-tier <t>     v3: self | steward | independent (independent needs --verifier-key/--verifier-key-id).
  --bundle-version <2|3>  Certification bundle format. Default 2 (corrected 2026-09-03, RFC 0168 §E.4; the text said 1 while the code set 2). Version 2 (RFC 0148
                        §C) records per-requirement DISPOSITIONS instead of pass/fail/skip
                        file lists, so "we could not check" stops being indistinguishable
                        from "checked and it holds". See the note it prints.
  --max-workers <n>     Cap concurrently running scenario files (vitest --maxWorkers).
                        Default: one worker per CPU. Use a small number against a
                        rate-limited production origin so 429s don't read as failures.
                        (env: OPENWOP_MAX_WORKERS)
  --certify <out.json>  Generate a machine-readable conformance certification
                        bundle: fetch /.well-known/openwop (captured verbatim +
                        SHA-256), derive claimedProfiles from it, run the suite
                        recording each scenario's terminal state, validate the
                        assembled bundle against the bundle schema, and write it
                        to <out.json>. Requires --base-url (and --api-key as usual).

Other:
  --help, -h            Show this message

Examples:
  openwop-conformance --offline
  openwop-conformance --base-url https://api.example.com --api-key hk_test_abc
  openwop-conformance --filter "discovery|errors"
  openwop-conformance --base-url https://api.example.com --api-key hk_test_abc \\
    --certify certification-bundle.json
`;

/** This CLI package's own version — surfaced as `generator.version` + `suite.version`. */
function suiteVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolvePath(here, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/**
 * Deterministic canonical-JSON serialization (RFC 8785 spirit): object keys
 * sorted lexicographically at every level, arrays preserved in order. Used to
 * compute `discovery.sha256` so a verifier can re-derive the same digest from
 * a live `/.well-known/openwop` fetch regardless of incidental key order.
 */
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',')}}`;
}

/**
 * The full set of profiles a discovery document derives — the closed
 * `deriveProfiles` catalog plus the two operational annexes
 * (`openwop-core-standard`, `openwop-agent-platform`) when their discovery
 * predicate holds. This is `claimedProfiles`: a generated bundle MUST NOT
 * claim a profile its own discovery document does not derive (RFC 0089 §B(1)).
 */
function claimedProfilesFor(doc: DiscoveryPayload): string[] {
  const profiles: string[] = [...deriveProfiles(doc)];
  if (isCoreStandard(doc)) profiles.push('openwop-core-standard');
  if (agentPlatformStatus(doc) !== 'none') profiles.push('openwop-agent-platform');
  return profiles;
}

/**
 * The v2 profile registry is a set of predicates over the DECLARATION
 * (RFC 0169 §C.1): every listed family present as a record, every listed
 * metadata key present. The v1 derivation cannot stand in — `isCore` wants a
 * root `protocolVersion` plus `supportedEnvelopes`/`schemaVersions`/`limits`,
 * shapes a closed v2 root does not have — so a major-2 run claimed NOTHING and
 * no v2 host could ever certify. Falls back to the empty set only when the
 * registry is genuinely absent from the layout, and says so.
 */
function claimedProfilesForV2(doc: DiscoveryPayload, conformanceRoot: string): string[] {
  // Resolve the peer the way `lib/paths.ts` does — through Node's resolver from
  // this package — instead of guessing directory shapes. Hand-rolled candidates
  // found the registry in a repo checkout and missed it in every published
  // install, where npm hoists the peer to a SIBLING package dir: the probe that
  // walked one level up landed on the `@openwop/` scope directory, not a
  // package, so a real host run silently claimed nothing.
  const candidates = [];
  try {
    const req = createRequire(resolvePath(conformanceRoot, 'package.json'));
    candidates.push(resolvePath(dirname(req.resolve('@openwop/spec-artifacts/package.json')), 'spec', 'v2', 'profiles.json'));
  } catch { /* not installed as a package; the repo-layout candidates below */ }
  candidates.push(
    resolvePath(conformanceRoot, 'spec', 'v2', 'profiles.json'),
    resolvePath(conformanceRoot, '..', 'spec', 'v2', 'profiles.json'),
    resolvePath(conformanceRoot, '..', 'spec-artifacts', 'spec', 'v2', 'profiles.json'),
  );
  const found = candidates.find((c) => existsSync(c));
  if (found === undefined) {
    process.stderr.write('openwop-conformance --certify: spec/v2/profiles.json not found in this layout; claimedProfiles is empty (RFC 0169 §C.1).\n');
    return [];
  }
  let registry: { profiles?: Array<{ id?: unknown; predicate?: { families?: unknown; metadata?: unknown } }> };
  try {
    registry = JSON.parse(readFileSync(found, 'utf8'));
  } catch {
    process.stderr.write(`openwop-conformance --certify: ${found} is unreadable; claimedProfiles is empty.\n`);
    return [];
  }
  const root = doc as unknown as Record<string, unknown>;
  const isRecord = (k: string): boolean => {
    const v = root[k];
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  };
  const out: string[] = [];
  for (const p of registry.profiles ?? []) {
    if (typeof p.id !== 'string') continue;
    const families = Array.isArray(p.predicate?.families) ? (p.predicate.families as unknown[]).map(String) : [];
    const metadata = Array.isArray(p.predicate?.metadata) ? (p.predicate.metadata as unknown[]).map(String) : [];
    if (families.every(isRecord) && metadata.every((k) => root[k] !== undefined)) out.push(p.id);
  }
  return out;
}

/** A single scenario test file's terminal state, derived from the vitest JSON report. */
type ScenarioState = 'passed' | 'failed' | 'skipped';

/** The subset of vitest's JSON reporter output we read. */
interface VitestJsonReport {
  readonly testResults?: ReadonlyArray<{
    readonly name?: string;
    readonly assertionResults?: ReadonlyArray<{ readonly status?: string }>;
  }>;
}

/**
 * Reduce a vitest JSON report into a per-scenario-file terminal state, keyed by
 * the test-file basename (e.g. `discovery.test.ts`) to align with the basenames
 * in `PROFILE_FLOOR_SCENARIOS`. A file is `passed` only if it ran AND had ≥1
 * passing assertion AND zero failures (non-vacuous, per §C); a fully-skipped
 * file is `skipped`; any failed assertion makes the file `failed`.
 */
function scenarioStatesFromReport(report: VitestJsonReport): Map<string, ScenarioState> {
  const states = new Map<string, ScenarioState>();
  for (const file of report.testResults ?? []) {
    const name = file.name;
    if (typeof name !== 'string') continue;
    const basename = name.split('/').pop() ?? name;
    const assertions = file.assertionResults ?? [];
    let passes = 0;
    let failures = 0;
    let nonSkipped = 0;
    for (const a of assertions) {
      if (a.status === 'passed') {
        passes++;
        nonSkipped++;
      } else if (a.status === 'failed') {
        failures++;
        nonSkipped++;
      }
      // `skipped` / `todo` / `pending` count toward neither pass nor fail.
    }
    let state: ScenarioState;
    if (failures > 0) state = 'failed';
    else if (passes > 0 && nonSkipped > 0) state = 'passed';
    else state = 'skipped';
    states.set(basename, state);
  }
  return states;
}

/** Generate + validate + write an RFC 0089 conformance certification bundle. */
/**
 * Suite 2.0.0 — resolve the target major (RFC 0168 §D.3 / RFC 0179): the flag,
 * else the host's root `preferredVersion`, else max(protocolVersions[]), else 1.
 * Returns the major and the scenario files that target it (scenario-majors.json).
 */
async function resolveTargetMajor(args: ParsedArgs, baseUrl: string | undefined, apiKey: string | undefined, conformanceRoot: string): Promise<{ major: 1 | 2; files: string[]; source: string }> {
  let major: 1 | 2 | undefined = args.targetMajor;
  let source = 'flag';
  let dualStack = false;
  if (major === undefined && baseUrl) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/.well-known/openwop`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
      const doc = (await res.json()) as { preferredVersion?: string; protocolVersions?: string[] };
      const pv = doc.preferredVersion ?? (doc.protocolVersions ?? []).map((v) => v).sort((a, b) => Number(b.split('.')[0]) - Number(a.split('.')[0]))[0];
      if ((doc.protocolVersions ?? []).some((v) => v.startsWith('2.'))) dualStack = true;
      if (pv) { major = Number(pv.split('.')[0]) >= 2 ? 2 : 1; source = doc.preferredVersion ? 'preferredVersion' : 'max(protocolVersions[])'; }
    } catch { /* unreachable host: the default below; the run itself will report the failure */ }
  }
  if (major === undefined) { major = 1; source = 'default'; }
  // Through the overlap `preferredVersion` names the 1.x member (versioning.md
  // §1.1), so auto-detection on a dual-stack host resolves to major 1 by design.
  // Say so, or an operator reads a v1 run as the host's only option.
  if (major === 1 && dualStack) source += ' (the host also serves 2.x — pass --target-major 2 to measure it)';
  const manifest = JSON.parse(readFileSync(resolvePath(conformanceRoot, 'scenario-majors.json'), 'utf8')) as { majors: Record<string, number[]> };
  const files = Object.entries(manifest.majors).filter(([, m]) => m.includes(major as number)).map(([f]) => `src/scenarios/${f}`);
  return { major, files, source };
}

async function runCertify(args: ParsedArgs, baseUrl: string, apiKey: string): Promise<never> {
  const outPath = args.certify;
  if (outPath === undefined) process.exit(2);

  // (a) Fetch /.well-known/openwop verbatim + its canonical-JSON SHA-256.
  // The target is resolved FIRST: `/.well-known/openwop` is one resource whose
  // representation the `OpenWOP-Version` header selects, and through the overlap
  // the header-less representation is the v1 document (spec/v2/core/versioning.md
  // §1.1). Fetching it header-less on a major-2 run captured the v1 rendering, so
  // `claimedProfiles` came out as the v1 set and the bundle described a contract
  // the run never measured.
  const here = dirname(fileURLToPath(import.meta.url));
  const conformanceRoot = resolvePath(here, '..');
  const target = await resolveTargetMajor(args, baseUrl, apiKey, conformanceRoot);
  const discoveryUrl = `${baseUrl.replace(/\/$/, '')}/.well-known/openwop`;
  let document: DiscoveryPayload;
  try {
    const resp = await fetch(discoveryUrl, { headers: { Accept: 'application/json', ...(target.major === 2 ? { 'OpenWOP-Version': '2.0' } : {}) } });
    if (!resp.ok) {
      process.stderr.write(
        `openwop-conformance --certify: GET ${discoveryUrl} returned HTTP ${resp.status}.\n`,
      );
      process.exit(2);
    }
    document = (await resp.json()) as DiscoveryPayload;
  } catch (err) {
    process.stderr.write(
      `openwop-conformance --certify: failed to fetch ${discoveryUrl}: ${String(err)}\n`,
    );
    process.exit(2);
  }
  const sha256 = createHash('sha256').update(canonicalJSON(document)).digest('hex');

  // (b) Derive claimedProfiles from the captured document.
  const claimedProfiles = target.major === 2 ? claimedProfilesForV2(document, conformanceRoot) : claimedProfilesFor(document);

  // (c) Run the suite, capturing per-scenario terminal state via the vitest
  // JSON reporter. server-targeted scenarios live under src/scenarios/.
  const reportDir = mkdtempSync(join(tmpdir(), 'owp-certify-'));
  const reportFile = join(reportDir, 'vitest-report.json');
  // RFC 0148 §A ledger sink (S6): every scenario file records its disposition
  // (and assertion count) here; the runner reads it after the run so bundle v2
  // rows come from what scenarios RECORDED, not from per-file pass/fail/skip.
  const ledgerFile = join(reportDir, 'requirement-ledger.jsonl');
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.OPENWOP_BASE_URL = baseUrl;
  env.OPENWOP_API_KEY = apiKey;
  env.OPENWOP_LEDGER_PATH = ledgerFile;
  if (args.impl) env.OPENWOP_IMPLEMENTATION_NAME = args.impl;
  if (args.implVersion) env.OPENWOP_IMPLEMENTATION_VERSION = args.implVersion;

  env.OPENWOP_TARGET_MAJOR = String(target.major);
  process.stderr.write(`openwop-conformance --certify: target major ${target.major} (${target.source}); ${target.files.length} scenario file(s)\n`);
  const vitestArgs: string[] = [
    'vitest',
    'run',
    '--config',
    resolvePath(conformanceRoot, 'vitest.config.ts'),
    '--reporter=json',
    `--outputFile=${reportFile}`,
    ...maxWorkersArgs(args.maxWorkers),
    ...(args.filter ? ['--testNamePattern', args.filter] : []),
    ...target.files,
  ];
  const runResult = spawnSync('npx', vitestArgs, { cwd: conformanceRoot, env, stdio: 'inherit' });
  if (runResult.error) {
    process.stderr.write(
      `openwop-conformance --certify: failed to spawn vitest: ${String(runResult.error)}\n`,
    );
    process.exit(2);
  }

  let report: VitestJsonReport;
  const ledgerEntries = readLedgerFile(ledgerFile);
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8')) as VitestJsonReport;
  } catch (err) {
    process.stderr.write(
      `openwop-conformance --certify: could not read vitest JSON report at ${reportFile}: ${String(err)}\n`,
    );
    process.exit(2);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }

  const states = scenarioStatesFromReport(report);
  const passed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const [basename, state] of [...states.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (state === 'passed') passed.push(basename);
    else if (state === 'failed') failed.push(basename);
    else skipped.push(basename);
  }

  // (d) Assemble the bundle.
  const version = suiteVersion();
  const impl = (document as { implementation?: { name?: unknown; version?: unknown; vendor?: unknown } })
    .implementation;
  const hostName =
    args.impl ?? (typeof impl?.name === 'string' ? impl.name : 'unknown-host');
  const hostVersion =
    args.implVersion ?? (typeof impl?.version === 'string' ? impl.version : '0.0.0');
  const host: { name: string; version: string; vendor?: string } = {
    name: hostName,
    version: hostVersion,
  };
  if (typeof impl?.vendor === 'string') host.vendor = impl.vendor;

  const bundle = {
    bundleVersion: '1' as const,
    generatedAt: new Date().toISOString(),
    generator: { name: '@openwop/openwop-conformance --certify', version },
    suite: { package: '@openwop/openwop-conformance' as const, version },
    host,
    discovery: { url: discoveryUrl, sha256, document },
    claimedProfiles,
    results: {
      totals: {
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
        total: passed.length + failed.length + skipped.length,
      },
      passed,
      failed,
      skipped,
    },
  };

  // (d2) RFC 0148 §C — bundle v2.
  //
  // v1's `{passed, failed, skipped}` file lists cannot express the distinction
  // this program exists for. A file counted as `passed` whether its assertions
  // ran or its runner returned early, and `skipped` flattened three different
  // claims — operator-excluded, not-applicable, and could-not-check — of which
  // only the first two are certifiable.
  //
  // THE HONEST LIMIT, stated because it changes what a v2 bundle from this
  // runner means: the runner reads vitest's per-FILE outcome. It does not read
  // the RFC 0148 §A requirement ledger, because scenarios do not yet record
  // into it. So a skipped file cannot be split into `skipped` /`inapplicable` /
  // `blocked` here, and §A's rule is that an unclassifiable requirement resolves
  // to `blocked` — never to a pass. That is what this emits.
  //
  // The consequence is deliberate and correct: a v2 bundle produced today shows
  // a large `blocked` count and therefore does NOT certify. That is not a defect
  // in the emitter. It is the true state of the evidence, which v1 was unable to
  // represent and therefore reported as a clean skip.
  // (d1) RFC 0148 acceptance item 2 — requirement-level dispositions from the
  // ledger, and rejection of unclassified returns for a claimed profile.
  const derived = deriveRequirementDispositions(states, ledgerEntries, claimedProfiles, document as Record<string, unknown>);
  const notHeld = new Set(derived.verdicts.filter((v) => v.runtimeDerived && !v.held).map((v) => v.profile));
  const rejectedProfiles = derived.verdicts.filter((v) => v.unclassified.length > 0);
  if (rejectedProfiles.length > 0) {
    process.stderr.write(
      'openwop-conformance --certify: REJECTING certification — a claimed profile has UNCLASSIFIED floor requirements\n' +
        '  (no disposition recorded, or an executed-pass with assertionCount 0 — a witness of nothing). RFC 0148 §A\n' +
        '  resolves an unclassified requirement to `blocked`, never to a pass; the bundle is still written so the\n' +
        '  evidence is inspectable, but it does not certify and this process exits 3.\n' +
        rejectedProfiles.map((v) => `  - ${v.profile}: ${v.unclassified.join(', ')}\n`).join(''),
    );
  }

  if (args.bundleVersion === '3') {
    // ── Bundle v3 (RFC 0168 §E) ─────────────────────────────────────────────
    const build = args.hostBuild ?? (() => {
      const mm = /^(image-digest|commit|artifact-sha256):(.+)$/.exec(process.env['OPENWOP_HOST_BUILD'] ?? '');
      return mm ? { kind: mm[1] as BundleV3['host']['build']['kind'], id: mm[2] } : undefined;
    })();
    const signingKeyPem = args.signingKeyPath ? readFileSync(args.signingKeyPath, 'utf8') : process.env['OPENWOP_BUNDLE_SIGNING_KEY'];
    const keyId = args.signingKeyId ?? process.env['OPENWOP_BUNDLE_SIGNING_KEY_ID'];
    if (!build || !signingKeyPem || !keyId) {
      process.stderr.write('openwop-conformance --certify: a v3 bundle needs --host-build <kind>:<id> (or OPENWOP_HOST_BUILD), --signing-key <pem> (or OPENWOP_BUNDLE_SIGNING_KEY) and --signing-key-id (or OPENWOP_BUNDLE_SIGNING_KEY_ID) — an unsigned bundle does not exist in v3 (RFC 0168 §E.2).\n');
      process.exit(2);
    }
    const rows3: BundleV3Requirement[] = derived.requirements.map((r) => ({ id: r.requirementId, scenario: r.scenarioId, result: r.disposition as BundleV3Requirement['result'], ...(r.assertionCount === undefined ? {} : { assertions: r.assertionCount }), ...(r.detail === undefined ? {} : { detail: r.detail }) }));
    const totals3 = derived.totals;
    const doc3 = document as Record<string, unknown>;
    const protocolVersions = Array.isArray(doc3['protocolVersions']) ? (doc3['protocolVersions'] as string[]) : [String(doc3['protocolVersion'] ?? '')];
    const preferredVersion = typeof doc3['preferredVersion'] === 'string' ? (doc3['preferredVersion'] as string) : (protocolVersions[0] ?? '');
    // witnessCount: executed-pass rows on the profile's floor (PROFILE_FLOOR_SCENARIOS required + requiredAnyPrefix).
    const witnessCountFor = (profile: string): number => {
      const floor = PROFILE_FLOOR_SCENARIOS[profile];
      if (!floor) return 0;
      const onFloor = (scenario: string): boolean => floor.required.includes(scenario) || (floor.requiredAnyPrefix ?? []).some((pre) => scenario.startsWith(pre));
      return derived.requirements.filter((r) => r.disposition === 'executed-pass' && onFloor(r.scenarioId)).length;
    };
    const claimed3 = claimedProfiles.filter((p) => !(p in DEPRECATED_PROFILE_ALIASES)).map((p) => ({ id: p, evidenceTier: args.evidenceTier, witnessCount: witnessCountFor(p), certified: !notHeld.has(p) && !rejectedProfiles.some((v) => v.profile === p) && totals3.blocked === 0 }));
    let relaxations: BundleV3['host']['relaxations'];
    if (process.env['OPENWOP_HOST_RELAXATIONS']) { try { relaxations = JSON.parse(process.env['OPENWOP_HOST_RELAXATIONS']) as BundleV3['host']['relaxations']; } catch { process.stderr.write('openwop-conformance --certify: OPENWOP_HOST_RELAXATIONS is not JSON\n'); process.exit(2); } }
    const lockPath = resolvePath(conformanceRoot, 'dist', 'spec-artifacts.lock.json');
    const lock = existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, 'utf8')) as { version: string; stampSha256: string }) : undefined;
    const nonPass = rows3.filter((r) => r.result !== 'executed-pass');
    const unsigned: Omit<BundleV3, 'signature'> = {
      bundleVersion: '3',
      generatedAt: new Date().toISOString(),
      suite: { name: '@openwop/openwop-conformance', version, targetMajor: target.major, specArtifactsVersion: lock?.version ?? 'repo-layout', ...(lock ? { stampSha256: lock.stampSha256 } : {}) },
      host: { name: host.name, version: host.version, ...(host.vendor ? { vendor: host.vendor } : {}), build, signingKeyId: keyId, ...(relaxations && relaxations.length ? { relaxations } : {}) },
      discovery: { url: discoveryUrl, sha256, protocolVersions, preferredVersion },
      claimedProfiles: claimed3,
      results: { totals: totals3, requirements: rows3 },
      witnessSha256: witnessDigest(rows3),
      assertionCount: rows3.reduce((n, r) => n + (r.assertions ?? 0), 0),
      ...(nonPass.length ? { detail: { nonPass: nonPass.map((r) => ({ id: r.id, result: r.result, reason: r.detail ?? '' })) } } : {}),
    };
    const signature = signBundleV3(unsigned, signingKeyPem, keyId);
    const v3: BundleV3 = { ...unsigned, signature };
    if (args.evidenceTier === 'independent') {
      const vk = args.verifierKeyPath ? readFileSync(args.verifierKeyPath, 'utf8') : process.env['OPENWOP_BUNDLE_VERIFIER_KEY'];
      const vkId = args.verifierKeyId ?? process.env['OPENWOP_BUNDLE_VERIFIER_KEY_ID'];
      if (!vk || !vkId) { process.stderr.write('openwop-conformance --certify: --evidence-tier independent needs --verifier-key and --verifier-key-id (RFC 0168 §E.2)\n'); process.exit(2); }
      v3.verifierSignature = verifierSign(unsigned, vk, vkId);
    }
    const secrets3 = evidenceSecretsFromEnv(process.env, [apiKey, signingKeyPem]);
    const scrubbed3 = scrubEvidence(v3, secrets3);
    const v3Out = scrubbed3.value as BundleV3;
    const audit3 = verifyBundleV3(v3Out, { hostPublicKeyPem: publicKeyFromPrivate(signingKeyPem) });
    const emitterDefects = audit3.rejections.filter((r) => !['blocked-certified', 'relaxed-profile-certified', 'independent-unverifiable'].includes(r.kind));
    if (emitterDefects.length > 0) {
      process.stderr.write('openwop-conformance --certify: assembled v3 bundle FAILED self-verification (emitter defect):\n' + emitterDefects.map((r) => `  - [${r.kind}] ${r.detail}`).join('\n') + '\n');
      process.exit(2);
    }
    const v3Schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'certification-bundle.schema.json'), 'utf8')) as Record<string, unknown>;
    const v3Ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(v3Ajv);
    v3Ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'ids.schema.json'), 'utf8')) as Record<string, unknown>);
    const v3Validate = v3Ajv.compile(v3Schema);
    if (!v3Validate(v3Out)) {
      process.stderr.write('openwop-conformance --certify: assembled v3 bundle FAILED schema validation:\n' + `${JSON.stringify(v3Validate.errors, null, 2)}\n`);
      process.exit(2);
    }
    writeFileSync(outPath, `${JSON.stringify(v3Out, null, 2)}\n`);
    process.stdout.write(`openwop-conformance --certify: wrote bundle v3 → ${outPath} (${rows3.length} requirement rows, ${v3Out.assertionCount} assertions, witness ${v3Out.witnessSha256.slice(0, 12)}, signed by ${keyId}; certified: ${audit3.certifiedProfiles.join(', ') || 'none'})\n`);
    process.exit(rejectedProfiles.length > 0 ? 3 : failed.length > 0 ? 1 : 0);
  }

  if (args.bundleVersion === '2') {
    const scenarioIds = [...passed, ...failed, ...skipped].sort();
    const manifestSha = createHash('sha256').update(scenarioIds.join('\n'), 'utf8').digest('hex');
    // Configuration identity per RFC 0147 §A.4: what the run was pointed at, and
    // the discovery it saw. Two runs against differently-configured hosts are
    // different evidence, and this is what says so.
    const configSha = createHash('sha256')
      .update(`${baseUrl}\n${sha256}\n${process.env['OPENWOP_REQUIRE_BEHAVIOR'] ?? ''}`, 'utf8')
      .digest('hex');

    // Rows come from the ledger (S6). A file that recorded nothing is
    // `blocked` — unclassified — and, if it sits on a claimed floor, rejected above.
    const requirements = derived.requirements.map((r) => ({
      requirementId: r.requirementId,
      scenarioId: r.scenarioId,
      disposition: r.disposition,
      ...(r.detail === undefined ? {} : { detail: r.detail }),
      ...(r.assertionCount === undefined ? {} : { assertionCount: r.assertionCount }),
    }));

    const v2 = {
      bundleVersion: '2' as const,
      generatedAt: new Date().toISOString(),
      generator: { name: '@openwop/openwop-conformance --certify', version },
      suite: { package: '@openwop/openwop-conformance' as const, version },
      host,
      discovery: { url: discoveryUrl, sha256, document },
      // RFC 0155 §E: canonical ids only in `claimedProfiles`; a deprecated
      // alias that also derives (`openwop-core`, always alongside
      // `openwop-discovery-core`) is reported in `aliases`, never as a claim.
      // A runtime-derived profile (`PROFILE_FLOOR_SCENARIOS[p].runtimeDerived`,
      // today `openwop-node-packs`) is claimed only when the host HOLDS it — every
      // floor row a witnessed pass. Its discovery predicate is `openwop-core`, so
      // deriving the claim from discovery alone made every core host "claim" a
      // registry it never advertised (RFC 0025: the read surface has no advert).
      claimedProfiles: claimedProfiles.filter((p) => !(p in DEPRECATED_PROFILE_ALIASES) && !notHeld.has(p)),
      ...(claimedProfiles.some((p) => p in DEPRECATED_PROFILE_ALIASES)
        ? { aliases: claimedProfiles.filter((p) => p in DEPRECATED_PROFILE_ALIASES) }
        : {}),
      results: {
        totals: derived.totals,
        requirements,
      },
      scenarioManifestSha256: manifestSha,
      targetConfigurationSha256: configSha,
    };

    // RFC 0148 §C: secret canaries never enter evidence. Scrub the finished
    // document with the credential this run was handed, every OPENWOP_*
    // key/token/secret in the environment, and the conformance canary — a
    // scenario's `detail` string, the captured discovery document, or a host
    // field could carry any of them, and the emitter is the last place that
    // can guarantee they do not ship.
    const secrets = evidenceSecretsFromEnv(process.env, [apiKey]);
    const scrubbed = scrubEvidence(v2, secrets);
    const v2Out = scrubbed.value;
    if (scrubbed.redactedAt.length > 0) {
      process.stderr.write(
        `openwop-conformance --certify: REDACTED ${scrubbed.redactedAt.length} evidence field(s) that carried a configured secret or the conformance canary: ${scrubbed.redactedAt.slice(0, 8).join(', ')}${scrubbed.redactedAt.length > 8 ? ', …' : ''}\n`,
      );
    }
    // Self-audit with the consumer verifier: the emitter MUST NOT write a
    // document the verifier would reject on shape (duplicate rows, totals that
    // disagree with rows, unknown dispositions, a canary). Rejections scoped to
    // a claimed profile (unwitnessed / vacuous) are the exit-3 case below and
    // are reported through `derived`; a bundle-wide rejection here is a bug in
    // this emitter and exits 2.
    const selfAudit = verifyBundleV2(v2Out);
    if (selfAudit.rejections.length > 0) {
      process.stderr.write(
        'openwop-conformance --certify: assembled v2 bundle FAILED self-verification (emitter defect):\n' +
          selfAudit.rejections.map((r) => `  - [${r.kind}] ${r.detail}`).join('\n') +
          '\n',
      );
      process.exit(2);
    }

    const v2Schema = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, 'certification-bundle-v2.schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    const v2Ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(v2Ajv);
    const v2Validate = v2Ajv.compile(v2Schema);
    if (!v2Validate(v2Out)) {
      process.stderr.write(
        'openwop-conformance --certify: assembled v2 bundle FAILED schema validation:\n' +
          `${JSON.stringify(v2Validate.errors, null, 2)}\n`,
      );
      process.exit(2);
    }
    writeFileSync(outPath, `${JSON.stringify(v2Out, null, 2)}\n`);
    process.stdout.write(
      `openwop-conformance --certify: wrote bundle v2 to ${outPath}\n` +
        `  host: ${host.name}@${host.version}\n` +
        `  executed-pass ${derived.totals.executedPass} / executed-fail ${derived.totals.executedFail} / skipped ${derived.totals.skipped} / inapplicable ${derived.totals.inapplicable} / blocked ${derived.totals.blocked}\n` +
        (derived.ledgerPresent
          ? `  dispositions come from the RFC 0148 §A ledger (${ledgerEntries.length} entries recorded by the scenarios)\n`
          : `  NOTE: no ledger was recorded — every skipped file is 'blocked' (unclassifiable), which is the honest reading\n`) +
        (derived.totals.blocked > 0 ? `  a bundle with blocked > 0 does NOT certify — that is the state of the evidence, not a defect in this emitter\n` : '') +
        derived.verdicts.map((v) => `  ${v.profile}: ${v.runtimeDerived && !v.held ? `not held (runtime-derived — dropped from claimedProfiles; floor rows not witnessed passes: ${v.blocking.join(', ')})` : v.certifiable ? 'certifiable' : 'NOT certifiable'}${v.unclassified.length > 0 ? ` (unclassified: ${v.unclassified.length})` : ''}\n`).join(''),
    );
    process.exit(rejectedProfiles.length > 0 ? 3 : failed.length > 0 ? 1 : 0);
  }

  // (e) Validate against the bundle schema BEFORE writing.
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'conformance-certification-bundle.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const bundleScrub = scrubEvidence(bundle, evidenceSecretsFromEnv(process.env, [apiKey]));
  if (bundleScrub.redactedAt.length > 0) {
    process.stderr.write(
      `openwop-conformance --certify: REDACTED ${bundleScrub.redactedAt.length} evidence field(s) that carried a configured secret or the conformance canary\n`,
    );
  }
  const bundleOut = bundleScrub.value;
  if (!validate(bundleOut)) {
    process.stderr.write(
      'openwop-conformance --certify: assembled bundle FAILED schema validation:\n' +
        `${JSON.stringify(validate.errors, null, 2)}\n`,
    );
    process.exit(2);
  }

  writeFileSync(outPath, `${JSON.stringify(bundleOut, null, 2)}\n`);
  process.stdout.write(
    `openwop-conformance --certify: wrote certification bundle to ${outPath}\n` +
      `  host: ${host.name}@${host.version}\n` +
      `  claimedProfiles: ${claimedProfiles.length > 0 ? claimedProfiles.join(', ') : '(none)'}\n` +
      `  results: ${passed.length} passed / ${failed.length} failed / ${skipped.length} skipped\n`,
  );
  // Exit code mirrors the suite outcome: a failing run still produces a bundle
  // (the failures are recorded), but the process exit reflects pass/fail — and
  // 3 when a claimed profile has unclassified floor requirements (RFC 0148 §A;
  // v1 bundles cannot express the distinction, so the exit code carries it).
  process.exit(rejectedProfiles.length > 0 ? 3 : failed.length > 0 ? 1 : 0);
}

async function main(): Promise<never> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  // Env vars OVERRIDE flags only when the flag was unset (consistent
  // with the rest of the harness — env wins on the absence of CLI input).
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (args.baseUrl) env.OPENWOP_BASE_URL = args.baseUrl;
  if (args.apiKey) env.OPENWOP_API_KEY = args.apiKey;
  if (args.impl) env.OPENWOP_IMPLEMENTATION_NAME = args.impl;
  if (args.implVersion) env.OPENWOP_IMPLEMENTATION_VERSION = args.implVersion;

  // RFC 0089 — certification-bundle generation requires a live host.
  if (args.certify !== undefined) {
    if (!env.OPENWOP_BASE_URL || !env.OPENWOP_API_KEY) {
      process.stderr.write(
        'openwop-conformance --certify: --base-url and --api-key are required.\n' +
          'Run `openwop-conformance --help` for usage.\n',
      );
      process.exit(2);
    }
    return runCertify(args, env.OPENWOP_BASE_URL, env.OPENWOP_API_KEY);
  }

  if (!args.offline && (!env.OPENWOP_BASE_URL || !env.OPENWOP_API_KEY)) {
    process.stderr.write(
      'openwop-conformance: --base-url and --api-key are required (or use --offline).\n' +
        'Run `openwop-conformance --help` for usage.\n',
    );
    process.exit(2);
  }

  // Resolve the conformance directory relative to this script's location
  // so the CLI works regardless of the caller's cwd. Both the source
  // path (`src/cli.ts`) and the compiled path (`dist/cli.js`) live ONE
  // directory below the package root, so the same `..` works either way.
  const here = dirname(fileURLToPath(import.meta.url));
  const conformanceRoot = resolvePath(here, '..');

  // Build vitest argv. server-free subset is `fixtures-valid` +
  // `spec-corpus-validity`; the offline flag scopes the run to those.
  // Pass --config explicitly so vitest doesn't auto-discover an
  // ancestor config (e.g., a parent monorepo's vite.config.ts) when
  // the conformance package is used as a workspace member.
  const vitestArgs: string[] = ['run', '--config', resolvePath(conformanceRoot, 'vitest.config.ts')];
  const target = await resolveTargetMajor(args, env.OPENWOP_BASE_URL, env.OPENWOP_API_KEY, conformanceRoot);
  env.OPENWOP_TARGET_MAJOR = String(target.major);
  if (!args.offline) {
    process.stderr.write(`openwop-conformance: target major ${target.major} (${target.source}); ${target.files.length} scenario file(s)\n`);
    vitestArgs.push(...target.files);
  }
  if (args.offline) {
    // Suite 1.154.0: the offline set is a DECLARED property of the package —
    // exactly the server-free scenarios that ship in the tarball and run in
    // the published layout. `spec-corpus-validity.test.ts` left the set: it is
    // a corpus-coherence scenario (reads spec/v1, asserts nothing about a host)
    // and is no longer packed. See conformance/README.md §"--offline".
    vitestArgs.push('src/scenarios/fixtures-valid.test.ts');
  }
  if (args.filter) {
    vitestArgs.push('--testNamePattern', args.filter);
  }
  vitestArgs.push(...maxWorkersArgs(args.maxWorkers));

  const result = spawnSync('npx', ['vitest', ...vitestArgs], {
    cwd: conformanceRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    process.stderr.write(`openwop-conformance: failed to spawn vitest: ${String(result.error)}\n`);
    process.exit(2);
  }

  process.exit(result.status ?? 1);
}

void main();
