/**
 * RFC 0173 §B — `effect-identity-business-key` (suite 2.0.0, target major 2; gated on `idempotency`).
 *
 * Layer-2 effect identity is a core obligation keyed on business identity: a
 * host that advertises `idempotency` assigns a logical effect id once per
 * effect, stable across transport retries, injects it as the provider's
 * idempotency key, and serves `GET /runs/{runId}/effects`
 * (`schemas/v2/effect-ledger-projection.schema.json`) — each row
 * `{ effectId, nodeId, attempt, keying: business-identity | activity-recipe,
 * state, at }`, content-free of provider payloads (RFC 0150 §B; RFC 0173 §B row
 * C6.7; `spec/v2/core/security-defaults.md` §Layer-2 effect identity).
 *
 * Legs:
 *   1. the ledger read validates on a run of the noop fixture and every row's
 *      `keying` is one of the two documented modes;
 *   2. the "same provider key across two transport retries" leg needs the
 *      suite's fixture provider (RFC 0173 §D.2 G4 — a provider that rejects a
 *      changed key) driven through the seams profile; no such seam is
 *      catalogued, so that leg records `blocked` naming it.
 *
 * @see spec/v2/core/security-defaults.md §Layer-2 effect identity
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
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

describe('RFC 0173 §B — effect-identity-business-key (gated on idempotency)', () => {
  it('GET /runs/{runId}/effects validates and every row is keyed on business identity or the activity recipe', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('idempotency'))) return softSkip('inapplicable', 'idempotency family not advertised — no Layer-2 obligation (gate recorded under openwop.family.idempotency)');
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run to read`);

    const create = await driver.post('/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.requirement.0173.effect-identity-business-key', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);

    const res = await driver.get(`/runs/${encodeURIComponent(runId)}/effects`);
    expect(
      res.status,
      req('openwop.requirement.0173.effect-identity-business-key', 'security-defaults.md §Layer-2 effect identity', 'a host advertising `idempotency` MUST serve GET /runs/{runId}/effects with 200 (RFC 0173 §B)'),
    ).toBe(200);
    const check = v2Validator('effect-ledger-projection')(res.json);
    expect(
      check.ok,
      req('openwop.requirement.0173.effect-identity-business-key', 'effect-ledger-projection.schema.json', `the ledger projection MUST validate: ${check.errors}`),
    ).toBe(true);
    const body = res.json as { runId?: unknown; effects?: Array<{ effectId?: unknown; keying?: unknown; providerKey?: unknown }> };
    expect(body.runId, req('openwop.requirement.0173.effect-identity-business-key', 'effect-ledger-projection.schema.json runId', 'runId MUST echo the run read')).toBe(runId);
    const effects = body.effects ?? [];
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
    if (effects.length === 0) softSkip('inapplicable', 'the noop fixture issued no external effect — the per-row keying leg had no rows (an effect-issuing fixture would exercise it)');
  });

  it('the same provider key is presented across two transport retries', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('idempotency'))) return softSkip('inapplicable', 'idempotency family not advertised — no Layer-2 obligation (gate recorded under openwop.family.idempotency)');
    if (!seamsProfileAdvertised(doc)) return softSkip('blocked', 'the retry leg is driven through the suite fixture provider (RFC 0173 §D.2 G4) under the seams profile — seams profile not advertised');
    // The seam this leg needs: POST ${SEAMS_PREFIX}/sample/test/idempotency/effect-retry
    // { providerUrl } → { runId, effectId } where the suite's fixture provider
    // records the idempotency key of each attempt and rejects a changed key.
    const probe = await driver.post(`${SEAMS_PREFIX}/sample/test/idempotency/effect-retry`, { providerUrl: 'http://127.0.0.1:1/' });
    if (probe.status === 404 || probe.status === 403 || probe.status === 405) {
      return softSkip('blocked', `no seam drives an effect through the suite fixture provider with a forced transport retry — ${SEAMS_PREFIX}/sample/test/idempotency/effect-retry answered ${probe.status} (the §25 concurrent-claim seam exercises Layer 1, not the provider key)`);
    }
    return softSkip('blocked', `${SEAMS_PREFIX}/sample/test/idempotency/effect-retry answered ${probe.status} but has no contract in api/seams-v2.yaml — not asserted against an uncatalogued seam`);
  });
});
