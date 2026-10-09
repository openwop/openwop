/**
 * RFC 0173 §B — the effect ledger read and its keying (suite 2.45.30, target
 * major 2; gated on `idempotency` and the `conformance-noop` fixture).
 *
 * A host that advertises `idempotency` serves `GET /runs/{runId}/effects`
 * (`schemas/v2/effect-ledger-projection.schema.json`); every row's `keying` is
 * `business-identity` or the documented fallback `activity-recipe`, each
 * effect id is assigned once, and `providerKey` is never credential material
 * (RFC 0150 §B; `spec/v2/core/security-defaults.md` §Layer-2 effect identity).
 *
 * This leg needs no seam. Until 2.45.30 it was the first leg of
 * `v2-effect-identity-business-key`, a floor of `openwop-conformance-seams-v2`,
 * and its pass certified that profile on hosts that mount no seams.
 *
 * @see spec/v2/core/security-defaults.md §Layer-2 effect identity
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-noop';
const KEYING = ['business-identity', 'activity-recipe'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

async function waitTerminal(runId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    if (res.status === 200 && TERMINAL.has(String((res.json as { status?: unknown } | null)?.status))) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('RFC 0173 §B — effect ledger keying (gated on idempotency)', () => {
  it('GET /runs/{runId}/effects validates and every row is keyed on business identity or the activity recipe', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('idempotency'))) return softSkip('inapplicable', 'idempotency family not advertised — no Layer-2 obligation (gate recorded under openwop.family.idempotency)');
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run to read`);

    // Unfailable-leg audit (2026-09-26): the noop fixture issues no effects, so
    // the per-row loop asserted nothing on any host, and the trailing
    // `softSkip('inapplicable')` (called without `return`, after four passing
    // setup asserts) recorded `executed-pass` with a `partial-witness:` detail —
    // a host that mis-keyed every effect passed this row. Now no expect passes
    // before the empty-ledger check: a failing setup read still fails, and an
    // empty but well-formed ledger returns `inapplicable` with zero assertions.
    const create = await driver.post('/runs', { workflowId: FIXTURE });
    if (create.status !== 201) {
      expect(create.status, req('openwop.requirement.0173.effect-identity-business-key', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    }
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);

    const res = await driver.get(`/runs/${encodeURIComponent(runId)}/effects`);
    const check = v2Validator('effect-ledger-projection')(res.json);
    const body = res.json as { runId?: unknown; effects?: Array<{ effectId?: unknown; keying?: unknown; providerKey?: unknown }> } | null;
    const effects = body?.effects ?? [];
    if (res.status === 200 && check.ok && body?.runId === runId && effects.length === 0) {
      // partial-witness-ok: no assertion has passed at runtime. The only earlier
      // expect runs solely when the create is not 201, and then it throws, so this
      // skip is a zero-assertion `inapplicable` (the gate reads source order).
      return softSkip('inapplicable', 'the noop fixture issued no external effect — the ledger read is well-formed but the per-row keying leg had no rows (an effect-issuing fixture would exercise it)');
    }
    expect(
      res.status,
      req('openwop.requirement.0173.effect-identity-business-key', 'security-defaults.md §Layer-2 effect identity', 'a host advertising `idempotency` MUST serve GET /runs/{runId}/effects with 200 (RFC 0173 §B)'),
    ).toBe(200);
    expect(
      check.ok,
      req('openwop.requirement.0173.effect-identity-business-key', 'effect-ledger-projection.schema.json', `the ledger projection MUST validate: ${check.errors}`),
    ).toBe(true);
    expect(body?.runId, req('openwop.requirement.0173.effect-identity-business-key', 'effect-ledger-projection.schema.json runId', 'runId MUST echo the run read')).toBe(runId);
    const ids = new Set<string>();
    for (const e of effects) {
      expect(
        KEYING,
        req('openwop.requirement.0173.effect-identity-business-key', 'security-defaults.md §Layer-2 effect identity', `keying MUST be business-identity or activity-recipe (the documented fallback) — effect ${String(e.effectId)} declares ${String(e.keying)}`),
      ).toContain(e.keying);
      // One logical effect id per effect: a duplicate row is a re-assignment.
      expect(
        ids.has(String(e.effectId)),
        req('openwop.requirement.0173.effect-identity-business-key', 'RFC 0150 §B', `effectId ${String(e.effectId)} MUST be assigned once per effect (duplicate ledger row)`),
      ).toBe(false);
      ids.add(String(e.effectId));
      if (typeof e.providerKey === 'string') {
        expect(
          /(secret|bearer |sk-[a-z0-9]{8,})/i.test(e.providerKey),
          req('openwop.requirement.0173.effect-identity-business-key', 'effect-ledger-projection.schema.json providerKey', 'providerKey is a redaction-safe identity, never credential material'),
        ).toBe(false);
      }
    }
  });
});
