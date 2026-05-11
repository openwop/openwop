import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  HTTP_ERROR_CODES,
  isHttpErrorCode,
  RUN_ERROR_CODES,
  isRunErrorCode,
  type HttpErrorCode,
  type RunError,
  type RunErrorCode,
} from '../run-helpers.js';

// Repo-root relative path to the canonical run-snapshot schema. Four
// `..` segments: __tests__ → src → typescript → sdk → repo-root, then
// schemas/.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', '..', 'schemas', 'run-snapshot.schema.json');

/**
 * Snake_case identifier pattern for the `RUN_ERROR_CODES` membership
 * check. Hoisted to module scope so it's grep-able + can be reused if
 * future tests need the same shape.
 */
const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

interface RunSnapshotSchema {
  properties?: {
    status?: {
      enum?: readonly string[];
    };
  };
}

/**
 * Read the canonical run-status enum directly from
 * `schemas/run-snapshot.schema.json`. Drives the union-coverage test
 * below from the source-of-truth instead of a hand-typed list — schema
 * additions/removals automatically fail the test until the helpers
 * catch up. Returns a sorted array for deterministic comparison.
 */
function loadSpecRunStatuses(): string[] {
  const raw = readFileSync(SCHEMA_PATH, 'utf8');
  const schema = JSON.parse(raw) as RunSnapshotSchema;
  const enumValues = schema.properties?.status?.enum;
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    throw new Error(
      `Could not read enum from ${SCHEMA_PATH}. Schema shape may have changed.`,
    );
  }
  return [...enumValues].sort();
}

describe('isTerminalRunStatus', () => {
  it('returns false for every spec-known active status', () => {
    for (const status of ACTIVE_RUN_STATUSES) {
      expect(isTerminalRunStatus(status), `${status} should be active`).toBe(false);
    }
  });

  it('returns true for every spec-known terminal status', () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(isTerminalRunStatus(status), `${status} should be terminal`).toBe(true);
    }
  });

  it('treats unknown values as terminal-unknown per schema forward-compat clause', () => {
    // Engine-extension statuses NOT in the spec's narrow enum.
    // The schema explicitly says: "future statuses MAY be added; readers
    // SHOULD treat unknown values as terminal-unknown rather than throw."
    // The negative-set check means these all flip to terminal.
    expect(isTerminalRunStatus('planned')).toBe(true);
    expect(isTerminalRunStatus('executing')).toBe(true);
    expect(isTerminalRunStatus('waiting-external')).toBe(true);
    expect(isTerminalRunStatus('timed-out')).toBe(true);
    expect(isTerminalRunStatus('interrupted')).toBe(true);
    // Truly garbage strings also flip terminal — the polling loop must
    // not spin forever on a corrupted status field.
    expect(isTerminalRunStatus('totally-bogus-status')).toBe(true);
    expect(isTerminalRunStatus('')).toBe(true);
  });

  it('does NOT misclassify the spec\'s waiting-input as terminal', () => {
    // Regression guard: `waiting-input` is active per the spec; an
    // implementation that derived terminal-set from a different source
    // (e.g. main-repo engine which uses `waiting-external`) might miss
    // this distinction.
    expect(isTerminalRunStatus('waiting-input')).toBe(false);
  });
});

describe('TERMINAL_RUN_STATUSES + ACTIVE_RUN_STATUSES', () => {
  it('are disjoint sets', () => {
    const overlap = (TERMINAL_RUN_STATUSES as readonly string[]).filter((s) =>
      (ACTIVE_RUN_STATUSES as readonly string[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it('together cover the spec-narrow RunStatus union (read from schema)', () => {
    // Drives the expected union from `schemas/run-snapshot.schema.json`
    // at test time rather than a hand-typed list. Schema additions or
    // removals automatically fail this test until ACTIVE_RUN_STATUSES /
    // TERMINAL_RUN_STATUSES are updated to match.
    const specStatuses = loadSpecRunStatuses();
    const helperUnion = [...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES].sort();
    expect(helperUnion).toEqual(specStatuses);
  });
});

describe('RUN_ERROR_CODES', () => {
  it('contains no duplicates', () => {
    const set = new Set(RUN_ERROR_CODES);
    expect(set.size).toBe(RUN_ERROR_CODES.length);
  });

  it('uses snake_case identifiers (REST/MCP convention)', () => {
    for (const code of RUN_ERROR_CODES) {
      expect(code, `code "${code}" should be snake_case`).toMatch(SNAKE_CASE_RE);
    }
  });

  it('covers the documented openwop error vocabulary', () => {
    // Spot-check the load-bearing categories. Add cases here when adding
    // new codes — failing this test forces an explicit acknowledgment.
    expect(RUN_ERROR_CODES).toContain('auth_required');
    expect(RUN_ERROR_CODES).toContain('run_not_found');
    expect(RUN_ERROR_CODES).toContain('engine_version_mismatch');
    expect(RUN_ERROR_CODES).toContain('node_execution_failed');
    expect(RUN_ERROR_CODES).toContain('capability_not_provided');
    expect(RUN_ERROR_CODES).toContain('persistence_failed');
  });
});

describe('HTTP_ERROR_CODES', () => {
  it('contains no duplicates', () => {
    const set = new Set(HTTP_ERROR_CODES);
    expect(set.size).toBe(HTTP_ERROR_CODES.length);
  });

  it('uses snake_case identifiers (REST/MCP convention)', () => {
    for (const code of HTTP_ERROR_CODES) {
      expect(code, `code "${code}" should be snake_case`).toMatch(SNAKE_CASE_RE);
    }
  });

  it('covers the canonical REST error-envelope vocabulary', () => {
    expect(HTTP_ERROR_CODES).toContain('unauthenticated');
    expect(HTTP_ERROR_CODES).toContain('forbidden');
    expect(HTTP_ERROR_CODES).toContain('validation_error');
    expect(HTTP_ERROR_CODES).toContain('not_found');
    expect(HTTP_ERROR_CODES).toContain('rate_limited');
    expect(HTTP_ERROR_CODES).toContain('run_already_active');
    expect(HTTP_ERROR_CODES).toContain('idempotency_in_flight');
    expect(HTTP_ERROR_CODES).toContain('unsupported_stream_mode');
    expect(HTTP_ERROR_CODES).toContain('credential_forbidden');
    expect(HTTP_ERROR_CODES).toContain('internal_error');
  });
});

describe('isHttpErrorCode', () => {
  it('returns true for every known HTTP error code', () => {
    for (const code of HTTP_ERROR_CODES) {
      expect(isHttpErrorCode(code), `${code} should be recognized`).toBe(true);
    }
  });

  it('returns false for run-only codes, unknown strings, and non-strings', () => {
    expect(isHttpErrorCode('node_execution_failed')).toBe(false);
    expect(isHttpErrorCode('definitely_not_a_known_code')).toBe(false);
    expect(isHttpErrorCode('')).toBe(false);
    expect(isHttpErrorCode(undefined)).toBe(false);
    expect(isHttpErrorCode(null)).toBe(false);
    expect(isHttpErrorCode(42)).toBe(false);
  });

  it('narrows the type when used as a guard', () => {
    const value: unknown = 'unauthenticated';
    if (isHttpErrorCode(value)) {
      const code: HttpErrorCode = value;
      expect(code).toBe('unauthenticated');
    } else {
      expect.fail('guard should have narrowed');
    }
  });
});

describe('isRunErrorCode', () => {
  it('returns true for every known code', () => {
    for (const code of RUN_ERROR_CODES) {
      expect(isRunErrorCode(code), `${code} should be recognized`).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isRunErrorCode('definitely_not_a_known_code')).toBe(false);
    expect(isRunErrorCode('')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    expect(isRunErrorCode(undefined)).toBe(false);
    expect(isRunErrorCode(null)).toBe(false);
    expect(isRunErrorCode(42)).toBe(false);
    expect(isRunErrorCode({})).toBe(false);
    expect(isRunErrorCode(['auth_required'])).toBe(false);
  });

  it('narrows the type when used as a guard', () => {
    const value: unknown = 'auth_required';
    if (isRunErrorCode(value)) {
      // TypeScript should now infer `value` as RunErrorCode. This test
      // is a structural pin — if the type assertion fails to compile,
      // the guard's `value is RunErrorCode` annotation is broken.
      const code: RunErrorCode = value;
      expect(code).toBe('auth_required');
    } else {
      expect.fail('guard should have narrowed');
    }
  });
});

describe('RunError shape', () => {
  it('accepts a minimal valid shape', () => {
    const err: RunError = { code: 'auth_required', message: 'sign in' };
    expect(err.code).toBe('auth_required');
    expect(err.nodeId).toBeUndefined();
  });

  it('accepts the full shape with nodeId + details', () => {
    const err: RunError = {
      code: 'node_execution_failed',
      message: 'plan node threw',
      nodeId: 'plan-1',
      details: { providerStatus: 503 },
    };
    expect(err.nodeId).toBe('plan-1');
    expect(err.details?.providerStatus).toBe(503);
  });
});
