/** Argument parsing — global flags + per-command option/positional parsing. */

import { CliError } from './errors.js';

export interface GlobalOptions {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

/** Split the leading global flags off an argv, returning them + the remaining args. */
export function extractGlobalOptions(argv: string[], env = process.env): { globals: GlobalOptions; args: string[] } {
  const globals: GlobalOptions = {
    baseUrl: undefined,
    apiKey: undefined,
    json: false,
    quiet: false,
    verbose: false,
    help: false,
    version: false,
  };
  const args: string[] = [];
  let seenCommand = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const { flag, value } = splitFlag(arg);

    if (flag === '--base-url') {
      globals.baseUrl = value ?? takeValue(argv, ++i, '--base-url');
      continue;
    }
    if (flag === '--api-key') {
      globals.apiKey = value ?? takeValue(argv, ++i, '--api-key');
      continue;
    }
    if (arg === '--json') { globals.json = true; continue; }
    if (arg === '--quiet') { globals.quiet = true; continue; }
    if (arg === '--verbose') { globals.verbose = true; continue; }
    if ((arg === '--help' || arg === '-h') && !seenCommand) { globals.help = true; continue; }
    if (arg === '--version' && !seenCommand) { globals.version = true; continue; }

    args.push(arg);
    if (!arg.startsWith('-')) seenCommand = true;
  }

  return { globals, args };
}

/** Parse `argv` into a `{ options, positionals }` pair per a flag spec. */
export function parseOptions(
  argv: string[],
  spec: { bool?: string[]; value?: string[]; multi?: string[] } = {},
): { options: Record<string, any>; positionals: string[] } {
  const bools = new Set(spec.bool ?? []);
  const values = new Set(spec.value ?? []);
  const multi = new Set(spec.multi ?? []);
  const options: Record<string, any> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const { flag, value } = splitFlag(arg);
    if (bools.has(flag)) {
      options[toOptionName(flag)] = true;
      continue;
    }
    if (values.has(flag) || multi.has(flag)) {
      const resolved = value ?? takeValue(argv, ++i, flag);
      const name = toOptionName(flag);
      if (multi.has(flag)) {
        options[name] = [...(options[name] ?? []), resolved];
      } else {
        options[name] = resolved;
      }
      continue;
    }
    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }
    throw new CliError(`Unknown option: ${flag}`);
  }

  return { options, positionals };
}

export function splitFlag(arg: string): { flag: string; value: string | undefined } {
  const eq = arg.indexOf('=');
  if (eq === -1) return { flag: arg, value: undefined };
  return { flag: arg.slice(0, eq), value: arg.slice(eq + 1) };
}

export function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('-')) {
    throw new CliError(`${flag} requires a value`);
  }
  return value;
}

export function toOptionName(flag: string): string {
  return flag.replace(/^--?/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
