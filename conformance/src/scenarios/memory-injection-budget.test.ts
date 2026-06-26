/**
 * RFC 0113 — Memory Injection Budget.
 *
 * Verifies the new token-denominated bound on the live injection read:
 * `MemoryAdapter.list(memoryRef, { tokenBudget, rank, query })`
 * (`spec/v1/agent-memory.md` §"Injection budget"). The genuinely new
 * contribution is `tokenBudget`; `rank:'relevance'` DELEGATES to the
 * existing `memory.search` semantic mode (RFC 0080) — this scenario does
 * NOT assert a parallel ranking primitive, and the relevance leg soft-skips
 * unless the host ALSO advertises `memory.search` semantic.
 *
 * Capability-gated on `capabilities.memory.injectionBudget.supported === true`
 * (root-first per RFC 0073) via `behaviorGate`. Driven through the host-sample
 * memory seam — the `conformance-agent-memory-injection-budget` fixture (the
 * same `/v1/runs` + run-variable seam the other `agentMemory*` scenarios use to
 * reach the adapter), which seeds a set whose total exceeds the budget AND
 * includes one single entry larger than the whole budget, plus a BYOK-redacted
 * entry and a cross-tenant probe.
 *
 * Asserts: cumulative tokens ≤ `tokenBudget`; an over-budget single entry is
 * omitted (not truncated); `rank:'relevance'` ordering differs from recency on
 * the crafted fixture (only when `memory.search` semantic is advertised, else
 * soft-skip); and re-asserts SR-1 (redacted content) + CTI-1 (cross-tenant
 * probe empty) on the budgeted path as a regression guard.
 *
 * @see RFCS/0113-memory-injection-budget.md
 * @see spec/v1/agent-memory.md §"Injection budget"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const FIXTURE = 'conformance-agent-memory-injection-budget';
const PROFILE = 'openwop-memory-injection-budget';

interface MemoryInjectionBudgetCap {
  readonly supported?: boolean;
  readonly tokenCounter?: string;
}
interface MemorySearchCap {
  readonly supported?: boolean;
  readonly modes?: readonly string[];
}
interface MemoryCap {
  readonly injectionBudget?: MemoryInjectionBudgetCap;
  readonly search?: MemorySearchCap;
}

// ── cast-free typed accessors (no `as`) ──────────────────────────────────
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number';
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}
function stringOf(v: unknown): string | undefined {
  return isString(v) ? v : undefined;
}
function numberOf(v: unknown): number | undefined {
  return isNumber(v) ? v : undefined;
}
function booleanOf(v: unknown): boolean | undefined {
  return isBoolean(v) ? v : undefined;
}
function stringArrayOf(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every(isString) ? v : undefined;
}
function recordArrayOf(v: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(v) && v.every(isRecord) ? v : undefined;
}
function runIdOf(v: unknown): string | undefined {
  return isRecord(v) ? stringOf(v['runId']) : undefined;
}
function variablesOf(v: unknown): Record<string, unknown> | undefined {
  if (!isRecord(v)) return undefined;
  const vars = v['variables'];
  return isRecord(vars) ? vars : undefined;
}

function advertisesSemanticSearch(mem: MemoryCap | undefined): boolean {
  const modes = mem?.search?.modes;
  return mem?.search?.supported === true && Array.isArray(modes) && modes.includes('semantic');
}

async function driveFixtureVariables(): Promise<Record<string, unknown> | undefined> {
  const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
  expect(create.status).toBe(201);
  const runId = runIdOf(create.json);
  expect(runId, 'POST /v1/runs MUST return a runId').toBeDefined();
  if (runId === undefined) return undefined;

  const terminal = await pollUntilTerminal(runId);
  expect(terminal.status).toBe('completed');

  const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
  return variablesOf(snap.json);
}

describe('memory-injection-budget (RFC 0113)', () => {
  it('token-bounds the injection read, omits the over-budget entry, and preserves SR-1 + CTI-1', async () => {
    const mem = await readCapabilityFamily<MemoryCap>('memory');
    if (!behaviorGate(PROFILE, mem?.injectionBudget?.supported === true)) return;
    if (!isFixtureAdvertised(FIXTURE)) return; // fixture-gated soft-skip

    const v = await driveFixtureVariables();
    expect(v, 'fixture MUST surface run variables').toBeDefined();
    if (v === undefined) return;

    // ── tokenBudget bound (the new lever) ──────────────────────────────
    const tokenBudget = numberOf(v['tokenBudget']);
    const total = numberOf(v['budgetedTokenTotal']);
    expect(tokenBudget, 'fixture MUST echo the requested tokenBudget').toBeDefined();
    expect(total, 'fixture MUST surface the budgeted cumulative token total').toBeDefined();
    // Cumulative tokens across the returned prefix MUST NOT exceed the budget.
    if (tokenBudget !== undefined && total !== undefined) {
      expect(total).toBeLessThanOrEqual(tokenBudget);
    }

    // ── over-budget single entry omitted (not truncated) ───────────────
    expect(
      booleanOf(v['overBudgetEntryOmitted']),
      'an entry larger than the whole budget MUST be omitted, not truncated mid-entry',
    ).toBe(true);
    const entries = recordArrayOf(v['budgetedEntries']);
    expect(entries, 'fixture MUST surface the budgeted entry slice').toBeDefined();
    const overId = stringOf(v['overBudgetEntryId']);
    if (entries !== undefined && overId !== undefined) {
      const ids = entries.map((e) => stringOf(e['id']));
      expect(ids, 'the over-budget entry MUST NOT appear in the returned slice').not.toContain(overId);
    }

    // ── SR-1 re-assertion on the budgeted path ─────────────────────────
    // A budgeted/ranked read ranks over already-redacted content; the read
    // surface MUST carry the redaction marker, never the plaintext.
    const redacted = stringOf(v['redactedContentSample']);
    expect(redacted, 'budgeted read MUST surface a redacted-content sample').toBeDefined();
    if (redacted !== undefined) {
      expect(redacted).toMatch(/\[REDACTED:[^\]]+\]/);
    }

    // ── CTI-1 re-assertion on the budgeted path ────────────────────────
    // A budget/rank prefix of an already-single-tenant list stays single-tenant:
    // the cross-tenant probe under the budgeted path MUST return empty.
    const probe = v['crossTenantBudgetedProbe'];
    if (Array.isArray(probe)) {
      expect(probe.length, 'cross-tenant probe on the budgeted path MUST return []').toBe(0);
    } else {
      expect(probe, 'cross-tenant probe on the budgeted path MUST return [] / null').toBeFalsy();
    }
  });

  it("rank:'relevance' reorders vs recency — only when memory.search semantic is ALSO advertised", async () => {
    const mem = await readCapabilityFamily<MemoryCap>('memory');
    if (!behaviorGate(PROFILE, mem?.injectionBudget?.supported === true)) return;
    // RFC 0113: rank:'relevance' DELEGATES to memory.search semantic (RFC 0080).
    // A host that does not advertise memory.search semantic MUST NOT fabricate a
    // relevance ranking — the relevance leg soft-skips here (it is not a new
    // ranking surface advertised by injectionBudget).
    if (!advertisesSemanticSearch(mem)) {
      // eslint-disable-next-line no-console
      console.warn(`[${PROFILE}] memory.search semantic not advertised; relevance leg soft-skipped`);
      return;
    }
    if (!isFixtureAdvertised(FIXTURE)) return;

    const v = await driveFixtureVariables();
    expect(v, 'fixture MUST surface run variables').toBeDefined();
    if (v === undefined) return;

    const recencyOrder = stringArrayOf(v['recencyOrder']);
    const relevanceOrder = stringArrayOf(v['relevanceOrder']);
    expect(recencyOrder, 'fixture MUST surface the recency ordering').toBeDefined();
    expect(relevanceOrder, 'fixture MUST surface the relevance ordering').toBeDefined();
    // The crafted fixture pins a query whose semantic top-k differs from the
    // most-recent-first order — relevance MUST reorder (not echo recency).
    expect(relevanceOrder).not.toEqual(recencyOrder);
  });
});
