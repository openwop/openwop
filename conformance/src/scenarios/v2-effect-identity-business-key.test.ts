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
import { softSkip, blockedDespiteAssertions } from '../lib/soft-skip.js';
import { startEffectReceiver } from '../lib/effect-receiver.js';
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

  it('the same provider key is presented across two transport retries', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('idempotency'))) return softSkip('inapplicable', 'idempotency family not advertised — no Layer-2 obligation (gate recorded under openwop.family.idempotency)');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the retry leg is driven through the suite fixture provider (RFC 0173 §D.2 G4) under the seams profile — seams profile not advertised');
    // The seam is catalogued (api/seams-v2.yaml `forceEffectTransportRetry`), and
    // its contract names the witness: "the suite fixture provider records the
    // idempotency key of each attempt". Until 2.42.4 this leg handed the host an
    // address nothing listened on (`http://127.0.0.1:1/`), so no suite-owned
    // party ever saw a key, and the only witness was the host's own ledger — a
    // host could record one constant providerKey while sending a fresh key on
    // every attempt. The suite's own receiver now cuts the FIRST attempt's
    // connection (a genuine transport failure, after recording its
    // Idempotency-Key) and answers the second, so the keys compared below are
    // the ones that crossed the wire.
    const rx = await startEffectReceiver({ failFirst: 1 });
    try {
    const fired = await driver.post(`${SEAMS_PREFIX}/sample/test/idempotency/effect-retry`, { providerUrl: rx.url });
    if (fired.status === 404 || fired.status === 403 || fired.status === 405) {
      return softSkip('blocked', `the host advertises the seams profile but does not serve ${SEAMS_PREFIX}/sample/test/idempotency/effect-retry (answered ${fired.status}) — the cross-retry keying leg cannot be driven`);
    }
    const body = fired.json as { runId?: unknown; effectId?: unknown } | null;
    if (fired.status !== 201 || typeof body?.runId !== 'string' || typeof body?.effectId !== 'string') {
      return softSkip('blocked', `${SEAMS_PREFIX}/sample/test/idempotency/effect-retry answered ${fired.status} without { runId, effectId } — the seam contract in api/seams-v2.yaml is 201 { runId, effectId }`);
    }
    const ledger = await driver.get(`/runs/${body.runId}/effects`);
    if (ledger.status !== 200) return softSkip('blocked', `GET /runs/{runId}/effects answered ${ledger.status} — the ledger is the witness for cross-retry keying`);
    const all = ((ledger.json as { effects?: unknown } | null)?.effects ?? []) as Array<Record<string, unknown>>;
    const attempts = all.filter((e) => e['effectId'] === body.effectId);
    if (attempts.length < 2) {
      return softSkip('blocked', `the seam produced ${attempts.length} ledger row(s) for effect ${String(body.effectId)} — a cross-retry assertion needs at least two attempts`);
    }
    // Unfailable-leg audit (2026-09-26): `providerKey` is optional in the ledger
    // schema and `?? ''` folded a missing key to '', so a host that recorded no
    // provider key on any attempt showed "one distinct key" and passed. Every
    // attempt now MUST carry a non-empty key. Remaining limit: the witness is
    // still the host's own ledger; a suite-owned receiver counting the
    // Idempotency-Key header on the wire (lib/effect-receiver.ts) is the
    // stronger follow-up, not done here.
    for (const a of attempts) {
      expect(
        typeof a['providerKey'] === 'string' && (a['providerKey'] as string).length > 0,
        req('openwop.requirement.0173.effect-identity-business-key.retry', 'spec/v2/core/idempotency.md §Layer 2: effect identity', `every attempt of one effect MUST record the provider key it presented — attempt ${String(a['attempt'])} recorded ${JSON.stringify(a['providerKey'] ?? null)}`),
      ).toBe(true);
    }
    const keys = new Set(attempts.map((e) => String(e['providerKey'])));
    expect(
      keys.size,
      req('openwop.requirement.0173.effect-identity-business-key.retry', 'spec/v2/core/idempotency.md §Layer 2: effect identity', `every attempt of one effect MUST present the same provider key across a transport retry — ${attempts.length} attempt(s) presented ${keys.size} distinct key(s)`),
    ).toBe(1);
    // idempotency.md §Layer 2: business identity is the rule, and the activity
    // recipe is "the fallback for a provider with no business key". The seam's
    // effect is a POST to a suite-chosen providerUrl, which has no business key,
    // so `activity-recipe` is the CONFORMANT keying here. Until 2.42.2 this leg
    // demanded `business-identity` on every attempt, which is stricter than the
    // spec, and a host honestly declaring the fallback failed. What the spec does
    // require of a retry is one effect, one key: every attempt carries a documented
    // keying, and the SAME one. A host that switches modes between attempts has
    // re-derived the effect's identity mid-flight.
    const keyings = new Set(attempts.map((a) => String(a['keying'])));
    for (const a of attempts) {
      expect(
        KEYING,
        req('openwop.requirement.0173.effect-identity-business-key.retry', 'spec/v2/core/idempotency.md §Layer 2: effect identity', `every attempt MUST declare a documented keying — business-identity, or activity-recipe for a provider with no business key (attempt ${String(a['attempt'])} declares ${String(a['keying'])})`),
      ).toContain(a['keying']);
    }
    expect(
      keyings.size,
      req('openwop.requirement.0173.effect-identity-business-key.retry', 'spec/v2/core/idempotency.md §Layer 2: effect identity', `every attempt of one effect MUST declare the same keying — ${attempts.length} attempt(s) declared ${[...keyings].join(', ')}`),
    ).toBe(1);
    // The wire half: what the provider actually received.
    const deadline = Date.now() + 10_000;
    while (rx.arrivals() < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const wire = rx.all().filter((a) => a.mine);
    if (wire.length < 2) {
      return blockedDespiteAssertions(`the suite's fixture provider saw ${wire.length} attempt(s) at ${rx.url} (local ${rx.localUrl}${rx.tunnelled ? ', tunnelled' : ''}) while the ledger records ${attempts.length} — the host's attempts did not reach the suite's receiver, so the keys on the wire are unobserved`);
    }
    for (const a of wire) {
      expect(
        typeof a.idempotencyKey === 'string' && a.idempotencyKey.length > 0,
        req('openwop.requirement.0173.effect-identity-business-key.retry', 'spec/v2/core/idempotency.md §Layer 2: effect identity', `every attempt MUST present an Idempotency-Key to the provider — an attempt at ${a.path} carried ${JSON.stringify(a.idempotencyKey ?? null)}`),
      ).toBe(true);
    }
    const wireKeys = new Set(wire.map((a) => a.idempotencyKey));
    expect(
      wireKeys.size,
      req('openwop.requirement.0173.effect-identity-business-key.retry', 'spec/v2/core/idempotency.md §Layer 2: effect identity', `the provider MUST see the same Idempotency-Key on every attempt of one effect — ${wire.length} attempt(s) on the wire carried ${wireKeys.size} distinct key(s)`),
    ).toBe(1);
    expect(
      [...wireKeys][0],
      req('openwop.requirement.0173.effect-identity-business-key.retry', 'spec/v2/core/idempotency.md §Layer 2: effect identity', 'the key the ledger records MUST be the key the provider received — a ledger that disagrees with the wire is not a witness'),
    ).toBe([...keys][0]);
    } finally {
      await rx.close();
    }
  });
});
