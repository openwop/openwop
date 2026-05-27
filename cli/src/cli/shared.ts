/**
 * Cross-group command helpers shared by multiple `src/cli/*` modules and the
 * top-level dispatcher. Kept dependency-light (errors + io + constants only)
 * so command modules can import these without cycling back through cli.ts.
 */
import { CliError } from '../errors.js';
import { formatTable } from '../io.js';
import { DEFAULT_BASE_URL, DEFAULT_API_KEY } from '../constants.js';

/** Build a run `inputs` object from --inputs-json (merged first) + --input k=v pairs. */
export function buildInputs(options) {
  const fromJson = options.inputsJson ? JSON.parse(options.inputsJson) : {};
  if (fromJson === null || typeof fromJson !== 'object' || Array.isArray(fromJson)) {
    throw new CliError('--inputs-json must be a JSON object');
  }
  const inputs = { ...fromJson };
  for (const pair of options.input ?? []) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new CliError(`--input must be key=value, got: ${pair}`);
    inputs[pair.slice(0, eq)] = parseInputValue(pair.slice(eq + 1));
  }
  return inputs;
}

/** JSON.parse a CLI value, falling back to the raw string on parse failure. */
export function parseInputValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseNodeVersion(version) {
  const [major, minor, patch] = version.split('.').map((v) => Number(v));
  return { major: major || 0, minor: minor || 0, patch: patch || 0 };
}

/** The implicit localhost API key, or undefined for remote hosts. */
export function defaultApiKeyFor(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return DEFAULT_API_KEY;
  } catch {
    return undefined;
  }
  return undefined;
}

export function normalizeBaseUrl(value) {
  if (!value) return DEFAULT_BASE_URL;
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

// ── doctor / readiness check result builders ──

export function ok(name, message) {
  return { status: 'ok', name, message };
}

export function warn(name, message) {
  return { status: 'warn', name, message };
}

export function fail(name, message) {
  return { status: 'fail', name, message };
}

export function formatCheckTable(checks) {
  return formatTable(
    checks.map((c) => ({ status: c.status.toUpperCase(), check: c.name, message: c.message })),
    ['status', 'check', 'message'],
  );
}
