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
import { dirname, resolve as resolvePath } from 'node:path';

interface ParsedArgs {
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly offline: boolean;
  readonly filter: string | undefined;
  readonly help: boolean;
  readonly impl: string | undefined;
  readonly implVersion: string | undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let baseUrl: string | undefined;
  let apiKey: string | undefined;
  let offline = false;
  let filter: string | undefined;
  let help = false;
  let impl: string | undefined;
  let implVersion: string | undefined;

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
      default:
        if (arg.startsWith('-')) {
          // Unknown flag — pass through to vitest by ignoring here.
        }
    }
  }

  return { baseUrl, apiKey, offline, filter, help, impl, implVersion };
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

Other:
  --help, -h            Show this message

Examples:
  openwop-conformance --offline
  openwop-conformance --base-url https://api.example.com --api-key hk_test_abc
  openwop-conformance --filter "discovery|errors"
`;

function main(): never {
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

main();
