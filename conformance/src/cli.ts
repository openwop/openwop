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
 *   OPENWOP_IMPLEMENTATION_VERSION, OPENWOP_LIFECYCLE_TIMEOUT_MS
 *
 * Exit codes:
 *   0   all scenarios pass
 *   1   one or more scenarios failed
 *   2   suite couldn't start (missing required args, etc)
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from './lib/paths.js';
import { readLedgerFile } from './lib/requirement-ledger.js';
import { deriveRequirementDispositions } from './lib/scenario-disposition.js';
import { scrubEvidence, evidenceSecretsFromEnv, verifyBundleV2 } from './lib/certification-bundle-verify.js';
import {
  deriveProfiles,
  isCoreStandard,
  agentPlatformStatus,
  DEPRECATED_PROFILE_ALIASES,
  type DiscoveryPayload,
} from './lib/profiles.js';

interface ParsedArgs {
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly offline: boolean;
  readonly filter: string | undefined;
  readonly help: boolean;
  readonly impl: string | undefined;
  readonly implVersion: string | undefined;
  /** RFC 0089 — emit a conformance certification bundle to this path. */
  readonly certify: string | undefined;
  readonly bundleVersion: '1' | '2';
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
  let bundleVersion: '1' | '2' = '1';
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
        const v = nextValue();
        if (v !== '1' && v !== '2') {
          process.stderr.write(`--bundle-version must be 1 or 2 (got '${v}')\n`);
          process.exit(2);
        }
        bundleVersion = v;
        break;
      }
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
  --offline             Run only the server-free subset (fixtures + spec corpus)
  --filter <pattern>    Pass through to vitest --testNamePattern

Implementation labels (cosmetic — surface in failure messages):
  --impl <name>             Implementation name        (env: OPENWOP_IMPLEMENTATION_NAME)
  --impl-version <version>  Implementation version     (env: OPENWOP_IMPLEMENTATION_VERSION)

Certification (RFC 0089):
  --bundle-version <1|2>  Certification bundle format. Default 1. Version 2 (RFC 0148
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
async function runCertify(args: ParsedArgs, baseUrl: string, apiKey: string): Promise<never> {
  const outPath = args.certify;
  if (outPath === undefined) process.exit(2);

  // (a) Fetch /.well-known/openwop verbatim + its canonical-JSON SHA-256.
  const discoveryUrl = `${baseUrl.replace(/\/$/, '')}/.well-known/openwop`;
  let document: DiscoveryPayload;
  try {
    const resp = await fetch(discoveryUrl, { headers: { Accept: 'application/json' } });
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
  const claimedProfiles = claimedProfilesFor(document);

  // (c) Run the suite, capturing per-scenario terminal state via the vitest
  // JSON reporter. server-targeted scenarios live under src/scenarios/.
  const here = dirname(fileURLToPath(import.meta.url));
  const conformanceRoot = resolvePath(here, '..');
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

  const vitestArgs: string[] = [
    'vitest',
    'run',
    '--config',
    resolvePath(conformanceRoot, 'vitest.config.ts'),
    '--reporter=json',
    `--outputFile=${reportFile}`,
    ...maxWorkersArgs(args.maxWorkers),
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

  if (args.bundleVersion === '2') {
    const scenarioIds = [...passed, ...failed, ...skipped].sort();
    const manifestSha = createHash('sha256').update(scenarioIds.join('\n'), 'utf8').digest('hex');
    // Configuration identity per RFC 0147 §A.4: what the run was pointed at, and
    // the discovery it saw. Two runs against differently-configured hosts are
    // different evidence, and this is what says so.
    const configSha = createHash('sha256')
      .update(`${args.baseUrl}\n${sha256}\n${process.env['OPENWOP_REQUIRE_BEHAVIOR'] ?? ''}`, 'utf8')
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
  if (args.offline) {
    vitestArgs.push(
      'src/scenarios/fixtures-valid.test.ts',
      'src/scenarios/spec-corpus-validity.test.ts',
    );
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
