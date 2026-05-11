/**
 * HITL interrupts for the SQLite reference host.
 *
 * Implements the baseline `interrupt.md` resolve surface
 * (`POST /v1/runs/{runId}/interrupts/{nodeId}`) plus the
 * `openwop-interrupt-quorum` profile (`interrupt-profiles.md`).
 *
 * Node types supported:
 *   - `core.approvalGate` — single-approver or quorum approval. Config:
 *     `{ actions: ['accept', 'reject'], requiredApprovals?: number,
 *        rejectionPolicy?: 'first'|'majority', approversList?: string[] }`.
 *   - `core.clarificationGate` — single-resolve clarification. Config:
 *     `{ questions: [{ id, question, kind? }] }`.
 *
 * Resolve semantics:
 *   - Approval: each POST adds one {action, voter, timestamp} vote. Resume
 *     fires when `accepts === requiredApprovals` (default 1). Termination
 *     fires when rejects satisfy the rejection policy (default 'first';
 *     'majority' terminates when rejects > floor(requiredApprovals / 2)).
 *   - Clarification: single POST with {answers: {questionId: string, ...}}.
 *     Each `id` declared in config.questions MUST appear in answers.
 *
 * @see spec/v1/interrupt.md
 * @see spec/v1/interrupt-profiles.md §openwop-interrupt-quorum
 */

import type Database from 'better-sqlite3';

export type InterruptKind = 'approval' | 'clarification';

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

export type InterruptConfig = ApprovalConfig | ClarificationConfig;

export interface Vote {
  readonly action: string;
  readonly voter?: string;
  readonly timestamp: string;
}

export interface InterruptRow {
  readonly run_id: string;
  readonly node_id: string;
  readonly kind: InterruptKind;
  readonly config_json: string;
  readonly payload_json: string;
  readonly votes_json: string;
  readonly resolved_at: string | null;
  readonly outcome: string | null;
}

export type ResolveOutcome =
  | { kind: 'pending'; votes: Vote[] }
  | { kind: 'resumed'; votes: Vote[]; finalAction: string }
  | { kind: 'rejected'; votes: Vote[] }
  | { kind: 'invalid'; status: 400 | 422; code: string; message: string }
  | { kind: 'unknown' };

export function setupInterruptSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interrupts (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      votes_json TEXT NOT NULL DEFAULT '[]',
      resolved_at TEXT,
      outcome TEXT,
      PRIMARY KEY (run_id, node_id),
      FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interrupts_run ON interrupts(run_id);
  `);
}

/** Persist a new interrupt when a node suspends. */
export function createInterrupt(
  db: Database.Database,
  runId: string,
  nodeId: string,
  kind: InterruptKind,
  config: InterruptConfig,
  payload: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO interrupts (run_id, node_id, kind, config_json, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(runId, nodeId, kind, JSON.stringify(config), JSON.stringify(payload));
}

export function getInterrupt(
  db: Database.Database,
  runId: string,
  nodeId: string,
): InterruptRow | undefined {
  return db
    .prepare('SELECT * FROM interrupts WHERE run_id = ? AND node_id = ? AND resolved_at IS NULL')
    .get(runId, nodeId) as InterruptRow | undefined;
}

/** Most-recent unresolved interrupt for the run, if any. */
export function getActiveInterrupt(
  db: Database.Database,
  runId: string,
): InterruptRow | undefined {
  return db
    .prepare(
      'SELECT * FROM interrupts WHERE run_id = ? AND resolved_at IS NULL ORDER BY rowid DESC LIMIT 1',
    )
    .get(runId) as InterruptRow | undefined;
}

function markResolved(
  db: Database.Database,
  runId: string,
  nodeId: string,
  outcome: string,
  votes: Vote[],
): void {
  db.prepare(
    `UPDATE interrupts SET resolved_at = ?, outcome = ?, votes_json = ?
     WHERE run_id = ? AND node_id = ?`,
  ).run(new Date().toISOString(), outcome, JSON.stringify(votes), runId, nodeId);
}

/** Update vote ledger without resolving (partial quorum). */
function updateVotes(
  db: Database.Database,
  runId: string,
  nodeId: string,
  votes: Vote[],
): void {
  db.prepare('UPDATE interrupts SET votes_json = ? WHERE run_id = ? AND node_id = ?').run(
    JSON.stringify(votes),
    runId,
    nodeId,
  );
}

/**
 * Apply an approval-gate resolve. Returns the outcome:
 *   - `pending`  — vote recorded; quorum not yet met
 *   - `resumed`  — accept-quorum reached, executor SHOULD continue
 *   - `rejected` — reject-policy triggered, run SHOULD terminate
 *   - `invalid`  — payload fails schema (caller MUST return 400/422)
 *   - `unknown`  — no active interrupt at (run, node) (caller MUST return 404)
 */
export function resolveApproval(
  db: Database.Database,
  runId: string,
  nodeId: string,
  resumeValue: unknown,
): ResolveOutcome {
  const row = getInterrupt(db, runId, nodeId);
  if (!row || row.kind !== 'approval') return { kind: 'unknown' };

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
  const config = JSON.parse(row.config_json) as ApprovalConfig;
  if (typeof action !== 'string' || !config.actions.includes(action)) {
    return {
      kind: 'invalid',
      status: 400,
      code: 'validation_error',
      message: `resumeValue.action MUST be one of [${config.actions.join(', ')}]`,
    };
  }

  const votes = JSON.parse(row.votes_json) as Vote[];
  const newVote: Vote = {
    action,
    timestamp: new Date().toISOString(),
    ...(typeof rv.voter === 'string' ? { voter: rv.voter } : {}),
  };

  // Idempotency on (voter, action): if a voter re-submits the same action,
  // keep one entry. A voter changing their vote replaces their prior entry.
  const dedupedVotes = newVote.voter
    ? [...votes.filter((v) => v.voter !== newVote.voter), newVote]
    : [...votes, newVote];

  const required = config.requiredApprovals ?? 1;
  const accepts = dedupedVotes.filter((v) => v.action === 'accept').length;
  const rejects = dedupedVotes.filter((v) => v.action === 'reject').length;
  const rejectionPolicy = config.rejectionPolicy ?? 'first';

  // Resume condition: enough accepts.
  if (accepts >= required) {
    markResolved(db, runId, nodeId, 'accepted', dedupedVotes);
    return { kind: 'resumed', votes: dedupedVotes, finalAction: 'accept' };
  }

  // Reject condition: per-policy.
  const rejectThreshold = rejectionPolicy === 'majority' ? Math.floor(required / 2) + 1 : 1;
  if (rejects >= rejectThreshold) {
    markResolved(db, runId, nodeId, 'rejected', dedupedVotes);
    return { kind: 'rejected', votes: dedupedVotes };
  }

  // Still waiting.
  updateVotes(db, runId, nodeId, dedupedVotes);
  return { kind: 'pending', votes: dedupedVotes };
}

/**
 * Apply a clarification-gate resolve. Returns `resumed` on success or
 * `invalid` on a payload that doesn't match the config's question set.
 */
export function resolveClarification(
  db: Database.Database,
  runId: string,
  nodeId: string,
  resumeValue: unknown,
): ResolveOutcome {
  const row = getInterrupt(db, runId, nodeId);
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

  const config = JSON.parse(row.config_json) as ClarificationConfig;
  const answers = rv.answers as Record<string, unknown>;
  for (const q of config.questions) {
    if (typeof answers[q.id] !== 'string') {
      return {
        kind: 'invalid',
        status: 422,
        code: 'validation_error',
        message: `Answer for question "${q.id}" MUST be a string.`,
      };
    }
  }

  // Single-vote resume.
  const vote: Vote = { action: 'resolve', timestamp: new Date().toISOString() };
  markResolved(db, runId, nodeId, 'resolved', [vote]);
  return { kind: 'resumed', votes: [vote], finalAction: 'resolve' };
}

/** Invalidate any active interrupt on a run (cancel cascade, parent-cancel, etc.). */
export function invalidateInterrupts(
  db: Database.Database,
  runId: string,
  reason: string,
): number {
  const result = db
    .prepare(
      `UPDATE interrupts SET resolved_at = ?, outcome = ?
       WHERE run_id = ? AND resolved_at IS NULL`,
    )
    .run(new Date().toISOString(), `invalidated:${reason}`, runId);
  return result.changes;
}
