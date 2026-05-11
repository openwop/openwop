/**
 * HITL interrupts for the Postgres reference host.
 *
 * Async-pg port of `examples/hosts/sqlite/src/interrupts.ts`. Wire surface
 * and semantics are byte-for-byte identical — the conformance suite's
 * 6 interrupt scenarios run unmodified against this host (the assertion
 * branches don't need to know which backing store they're hitting).
 *
 * Postgres-specific translations:
 *   - `db.prepare(...).run/get/all` → `await q.query(sql, [params])` against
 *     the Querier abstraction. SQLite `?` placeholders → Postgres `$1`.
 *   - JSON columns are JSONB (indexable + queryable). pg-types unmarshals
 *     JSONB to JS objects, so `row.config_json` is already-parsed at read
 *     time — `JSON.parse` calls from the SQLite port are dropped.
 *   - SQLite `PRAGMA table_info()` for migrations → Postgres
 *     `information_schema.columns`. DDL is wrapped in DO $$ ... END $$
 *     blocks for the conditional ALTER pattern.
 *   - `result.changes` (better-sqlite3) → `result.rowCount` (pg).
 *
 * Functional parity:
 *   - 4 interrupt kinds: approval / clarification / external-event /
 *     auth-required (the auth-required profile is enforced at the route
 *     layer, not here; this module handles the resolve semantics).
 *   - Quorum-with-revote per-voter last-write-wins for approval.
 *   - Correlation-key shallow-equality match for external-event.
 *   - Signed callback tokens (16-byte base64url) for external-event;
 *     callback resolution looks up the interrupt by token, validates
 *     correlation, marks resolved.
 *   - Idempotent migration: ALTER TABLE adds callback_token / expires_at
 *     to older DBs.
 *
 * @see spec/v1/interrupt.md
 * @see spec/v1/interrupt-profiles.md §openwop-interrupt-quorum
 * @see examples/hosts/sqlite/src/interrupts.ts — the source of the port
 */

import { randomBytes } from 'node:crypto';
import type { Querier } from './db.js';

export type InterruptKind = 'approval' | 'clarification' | 'external-event';

export interface ApprovalConfig {
  readonly actions: ReadonlyArray<string>;
  readonly requiredApprovals?: number;
  readonly rejectionPolicy?: 'first' | 'majority';
  readonly approversList?: ReadonlyArray<string>;
  readonly title?: string;
  readonly description?: string;
}

export interface ClarificationConfig {
  readonly questions: ReadonlyArray<{ id: string; question: string; kind?: string }>;
}

export interface ExternalEventConfig {
  readonly eventType?: string;
  readonly correlation?: Record<string, unknown>;
  readonly timeoutMs?: number;
}

export type InterruptConfig = ApprovalConfig | ClarificationConfig | ExternalEventConfig;

export interface Vote {
  readonly action: string;
  readonly voter?: string;
  readonly timestamp: string;
}

/**
 * pg-types unmarshals JSONB columns to parsed JS values, so config_json /
 * payload_json / votes_json arrive as objects, not strings. Keep them
 * typed as `unknown` here and cast at use sites (same pattern the SQLite
 * port used, just without the JSON.parse wrapper).
 */
export interface InterruptRow {
  readonly run_id: string;
  readonly node_id: string;
  readonly kind: InterruptKind;
  readonly config_json: unknown;
  readonly payload_json: unknown;
  readonly votes_json: unknown;
  readonly resolved_at: string | null;
  readonly outcome: string | null;
  readonly callback_token: string | null;
  readonly expires_at: string | null;
}

export type ResolveOutcome =
  | { kind: 'pending'; votes: Vote[] }
  | { kind: 'resumed'; votes: Vote[]; finalAction: string }
  | { kind: 'rejected'; votes: Vote[] }
  | { kind: 'invalid'; status: 400 | 422; code: string; message: string }
  | { kind: 'expired' }
  | { kind: 'unknown' };

export async function setupInterruptSchema(q: Querier): Promise<void> {
  await q.query(`
    CREATE TABLE IF NOT EXISTS interrupts (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json JSONB NOT NULL,
      payload_json JSONB NOT NULL,
      votes_json JSONB NOT NULL DEFAULT '[]'::JSONB,
      resolved_at TEXT,
      outcome TEXT,
      callback_token TEXT,
      expires_at TEXT,
      PRIMARY KEY (run_id, node_id),
      FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_interrupts_run ON interrupts(run_id);`);
  await q.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interrupts_token ON interrupts(callback_token)
      WHERE callback_token IS NOT NULL;
  `);

  // Idempotent migration: older DBs may lack callback_token / expires_at.
  // Mirrors the SQLite port's PRAGMA table_info() check.
  await q.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'interrupts' AND column_name = 'callback_token'
      ) THEN
        ALTER TABLE interrupts ADD COLUMN callback_token TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_interrupts_token ON interrupts(callback_token)
          WHERE callback_token IS NOT NULL;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'interrupts' AND column_name = 'expires_at'
      ) THEN
        ALTER TABLE interrupts ADD COLUMN expires_at TEXT;
      END IF;
    END $$;
  `);
}

/** Generate a 128-bit unguessable token for signed-callback resume. */
export function generateCallbackToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Persist a new interrupt when a node suspends. Returns the callback
 * token for external-event kinds; null otherwise.
 */
export async function createInterrupt(
  q: Querier,
  runId: string,
  nodeId: string,
  kind: InterruptKind,
  config: InterruptConfig,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const callbackToken = kind === 'external-event' ? generateCallbackToken() : null;
  const timeoutMs =
    kind === 'external-event' ? (config as ExternalEventConfig).timeoutMs : undefined;
  const expiresAt =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? new Date(Date.now() + timeoutMs).toISOString()
      : null;
  await q.query(
    `INSERT INTO interrupts (run_id, node_id, kind, config_json, payload_json, callback_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      runId,
      nodeId,
      kind,
      JSON.stringify(config),
      JSON.stringify(payload),
      callbackToken,
      expiresAt,
    ],
  );
  return callbackToken;
}

export async function getInterrupt(
  q: Querier,
  runId: string,
  nodeId: string,
): Promise<InterruptRow | undefined> {
  const res = await q.query<InterruptRow>(
    'SELECT * FROM interrupts WHERE run_id = $1 AND node_id = $2 AND resolved_at IS NULL',
    [runId, nodeId],
  );
  return res.rows[0];
}

export async function getInterruptByToken(
  q: Querier,
  token: string,
): Promise<InterruptRow | undefined> {
  const res = await q.query<InterruptRow>(
    'SELECT * FROM interrupts WHERE callback_token = $1 AND resolved_at IS NULL',
    [token],
  );
  return res.rows[0];
}

export async function getActiveInterrupt(
  q: Querier,
  runId: string,
): Promise<InterruptRow | undefined> {
  // Use the ctid pseudo-column to order by insertion order — Postgres
  // doesn't have SQLite's `rowid`. ctid is a tuple identifier; later
  // inserts have higher ctids (within a single page; across pages,
  // ordering is approximate). For the conformance test's "single
  // active interrupt at a time" pattern this is fine; a multi-active-
  // interrupt host would add a `created_at TIMESTAMPTZ` column and
  // order on that explicitly.
  const res = await q.query<InterruptRow>(
    'SELECT * FROM interrupts WHERE run_id = $1 AND resolved_at IS NULL ORDER BY ctid DESC LIMIT 1',
    [runId],
  );
  return res.rows[0];
}

export function isInterruptExpired(row: InterruptRow): boolean {
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() <= Date.now();
}

/** Mark an interrupt as expired. Returns true iff a row was flipped. */
export async function markExpired(
  q: Querier,
  runId: string,
  nodeId: string,
): Promise<boolean> {
  const res = await q.query(
    `UPDATE interrupts SET resolved_at = $1, outcome = 'expired'
     WHERE run_id = $2 AND node_id = $3 AND resolved_at IS NULL`,
    [new Date().toISOString(), runId, nodeId],
  );
  return (res.rowCount ?? 0) > 0;
}

async function markResolved(
  q: Querier,
  runId: string,
  nodeId: string,
  outcome: string,
  votes: Vote[],
): Promise<void> {
  await q.query(
    `UPDATE interrupts SET resolved_at = $1, outcome = $2, votes_json = $3
     WHERE run_id = $4 AND node_id = $5`,
    [new Date().toISOString(), outcome, JSON.stringify(votes), runId, nodeId],
  );
}

async function updateVotes(
  q: Querier,
  runId: string,
  nodeId: string,
  votes: Vote[],
): Promise<void> {
  await q.query(
    'UPDATE interrupts SET votes_json = $1 WHERE run_id = $2 AND node_id = $3',
    [JSON.stringify(votes), runId, nodeId],
  );
}

/**
 * Approval-gate resolve. Each POST adds one {action, voter, timestamp}
 * vote. Resume fires when accepts >= requiredApprovals. Termination fires
 * when rejects satisfy rejectionPolicy ('first' or 'majority').
 *
 * Per-voter last-write-wins: a second vote from the same voter REPLACES
 * their prior vote (supports revote-after-discussion in quorum UX).
 * Anonymous votes (no voter id) always append.
 */
export async function resolveApproval(
  q: Querier,
  runId: string,
  nodeId: string,
  resumeValue: unknown,
): Promise<ResolveOutcome> {
  const row = await getInterrupt(q, runId, nodeId);
  if (!row || row.kind !== 'approval') return { kind: 'unknown' };
  if (isInterruptExpired(row)) {
    await markExpired(q, runId, nodeId);
    return { kind: 'expired' };
  }

  if (typeof resumeValue !== 'object' || resumeValue === null) {
    return {
      kind: 'invalid',
      status: 400,
      code: 'validation_error',
      message: 'resumeValue MUST be an object.',
    };
  }

  const rv = resumeValue as { action?: unknown; voter?: unknown };
  const action = rv.action;
  const config = row.config_json as ApprovalConfig;
  if (typeof action !== 'string' || !config.actions.includes(action)) {
    return {
      kind: 'invalid',
      status: 400,
      code: 'validation_error',
      message: `resumeValue.action MUST be one of [${config.actions.join(', ')}]`,
    };
  }

  const votes = (row.votes_json as Vote[]) ?? [];
  const newVote: Vote = {
    action,
    timestamp: new Date().toISOString(),
    ...(typeof rv.voter === 'string' ? { voter: rv.voter } : {}),
  };

  const updatedVotes = newVote.voter
    ? [...votes.filter((v) => v.voter !== newVote.voter), newVote]
    : [...votes, newVote];

  const required = config.requiredApprovals ?? 1;
  const accepts = updatedVotes.filter((v) => v.action === 'accept').length;
  const rejects = updatedVotes.filter((v) => v.action === 'reject').length;
  const rejectionPolicy = config.rejectionPolicy ?? 'first';

  if (accepts >= required) {
    await markResolved(q, runId, nodeId, 'accepted', updatedVotes);
    return { kind: 'resumed', votes: updatedVotes, finalAction: 'accept' };
  }

  const rejectThreshold = rejectionPolicy === 'majority' ? Math.floor(required / 2) + 1 : 1;
  if (rejects >= rejectThreshold) {
    await markResolved(q, runId, nodeId, 'rejected', updatedVotes);
    return { kind: 'rejected', votes: updatedVotes };
  }

  await updateVotes(q, runId, nodeId, updatedVotes);
  return { kind: 'pending', votes: updatedVotes };
}

/**
 * Clarification-gate resolve. Single POST with `{answers: {questionId:
 * string, ...}}`. Each `id` from config.questions MUST appear in answers
 * as a string.
 */
export async function resolveClarification(
  q: Querier,
  runId: string,
  nodeId: string,
  resumeValue: unknown,
): Promise<ResolveOutcome> {
  const row = await getInterrupt(q, runId, nodeId);
  if (!row || row.kind !== 'clarification') return { kind: 'unknown' };

  if (typeof resumeValue !== 'object' || resumeValue === null) {
    return {
      kind: 'invalid',
      status: 400,
      code: 'validation_error',
      message: 'resumeValue MUST be an object.',
    };
  }

  const rv = resumeValue as { answers?: unknown };
  if (typeof rv.answers !== 'object' || rv.answers === null) {
    return {
      kind: 'invalid',
      status: 400,
      code: 'validation_error',
      message: "resumeValue.answers MUST be an object keyed by question id.",
    };
  }

  const config = row.config_json as ClarificationConfig;
  const answers = rv.answers as Record<string, unknown>;
  for (const question of config.questions) {
    if (typeof answers[question.id] !== 'string') {
      return {
        kind: 'invalid',
        status: 422,
        code: 'validation_error',
        message: `Answer for question "${question.id}" MUST be a string.`,
      };
    }
  }

  const vote: Vote = { action: 'resolve', timestamp: new Date().toISOString() };
  await markResolved(q, runId, nodeId, 'resolved', [vote]);
  return { kind: 'resumed', votes: [vote], finalAction: 'resolve' };
}

/**
 * External-event resolve via signed callback token. The resume value
 * MUST shallow-match every key in the fixture's config.correlation map
 * (mismatches return invalid → caller MUST 422).
 */
export async function resolveExternalEvent(
  q: Querier,
  runId: string,
  nodeId: string,
  resumeValue: unknown,
): Promise<ResolveOutcome> {
  const row = await getInterrupt(q, runId, nodeId);
  if (!row || row.kind !== 'external-event') return { kind: 'unknown' };
  if (isInterruptExpired(row)) {
    await markExpired(q, runId, nodeId);
    return { kind: 'expired' };
  }

  if (typeof resumeValue !== 'object' || resumeValue === null) {
    return {
      kind: 'invalid',
      status: 400,
      code: 'validation_error',
      message: 'resumeValue MUST be an object.',
    };
  }

  const config = row.config_json as ExternalEventConfig;
  const correlation = config.correlation ?? {};
  const rv = resumeValue as Record<string, unknown>;
  for (const [key, expected] of Object.entries(correlation)) {
    if (!deepEqual(rv[key], expected)) {
      return {
        kind: 'invalid',
        status: 422,
        code: 'correlation_mismatch',
        message: `External event correlation key "${key}" expected ${JSON.stringify(expected)}, got ${JSON.stringify(rv[key])}.`,
      };
    }
  }

  const vote: Vote = { action: 'external-event', timestamp: new Date().toISOString() };
  await markResolved(q, runId, nodeId, 'resolved', [vote]);
  return { kind: 'resumed', votes: [vote], finalAction: 'external-event' };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/** Invalidate any active interrupt on a run (cancel cascade, parent-cancel, etc.). */
export async function invalidateInterrupts(
  q: Querier,
  runId: string,
  reason: string,
): Promise<number> {
  const res = await q.query(
    `UPDATE interrupts SET resolved_at = $1, outcome = $2
     WHERE run_id = $3 AND resolved_at IS NULL`,
    [new Date().toISOString(), `invalidated:${reason}`, runId],
  );
  return res.rowCount ?? 0;
}
