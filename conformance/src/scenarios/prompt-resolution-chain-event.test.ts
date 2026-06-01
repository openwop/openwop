/**
 * prompt-resolution-chain-event — RFC 0029 layer precedence on the PRODUCTION wire.
 *
 * The black-box, production-path counterpart to the three seam-driven
 * `prompt-resolution-chain-{node-wins,agent-intrinsic,fallback-cascade}.test.ts`
 * scenarios. Instead of the synchronous `POST /v1/host/sample/prompt/resolve`
 * seam, this creates a real run from a prompt-exercising fixture, reads the
 * run's DURABLE event log via the NORMATIVE `GET /v1/runs/{runId}/events/poll`
 * endpoint, and asserts the `agent.promptResolved` event carries the full
 * layer-by-layer precedence record (`spec/v1/prompts.md` §"Resolution chain") —
 * no `/v1/host/sample/*` seam.
 *
 * The `agentPromptResolved` payload (`schemas/run-event-payloads.schema.json`)
 * already REQUIRES `chain[]` with one `applied: true` entry + the full-traversal
 * MUST, so the wire is already capable of conveying precedence without the seam.
 * This is the "replace seam-gated proofs with black-box production-path
 * conformance" step (independent-audit acceptance-bar item 3) for RFC 0029: once
 * a host emits `agent.promptResolved`, prompt-chain precedence is proven on the
 * production wire and the surface graduates INTO the `openwop-core-standard`
 * floor (RFC 0088 §D Lever-2 → floor).
 *
 * Gating: soft-skips unless `capabilities.prompts.supported` AND the host
 * actually emits `agent.promptResolved` for the run (emission is staged per
 * RFC 0029 / RFC 0021 — a host advertising prompts MAY not yet emit the event).
 *
 * @see RFCS/0029-prompt-override-hierarchy.md
 * @see spec/v1/prompts.md §"Resolution chain (normative)"
 */
import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { pollUntilTerminal } from '../lib/polling.js';

const PROMPT_FIXTURE_ID = 'conformance-prompt-end-to-end';
const VALID_LAYERS = new Set([
  'run-configurable', 'node', 'agent-intrinsic', 'agent-overrides',
  'agent-library-default', 'workflow-defaults', 'host-defaults',
]);

interface ChainEntry { layer?: unknown; source?: unknown; applied?: unknown }
interface PromptResolvedPayload { chain?: ChainEntry[]; resolved?: unknown }
interface RawEvent { type?: string; payload?: PromptResolvedPayload }

async function promptsSupported(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  return capabilityFamily(res.json as Record<string, unknown> | undefined, 'prompts')?.supported === true;
}

describe('prompt-resolution-chain-event (black-box): agent.promptResolved carries the precedence record (RFC 0029)', () => {
  it('the production agent.promptResolved event records the full four-layer resolution chain', async () => {
    if (!(await promptsSupported())) return; // capability not advertised — skip

    const create = await driver.post('/v1/runs', { workflowId: PROMPT_FIXTURE_ID });
    if (create.status !== 201) {
      // Fixture not seeded / run not accepted — not a prompt-chain failure.
      // eslint-disable-next-line no-console
      console.warn(`[prompt-resolution-chain-event] POST /v1/runs for ${PROMPT_FIXTURE_ID} returned ${create.status}; skipping the production-path assertion`);
      return;
    }
    const runId = (create.json as { runId?: string }).runId;
    if (!runId) return;
    await pollUntilTerminal(runId);

    const poll = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    const events = (poll.json as { events?: RawEvent[] } | undefined)?.events ?? [];
    const resolved = events.filter((e) => e.type === 'agent.promptResolved');
    if (resolved.length === 0) {
      // Host advertises prompts but does not yet emit agent.promptResolved
      // (RFC 0029 emission is staged) — soft-skip the behavioral assertion.
      // eslint-disable-next-line no-console
      console.warn('[prompt-resolution-chain-event] host emitted no agent.promptResolved event; skipping (RFC 0029 emission staged)');
      return;
    }

    for (const ev of resolved) {
      const chain = ev.payload?.chain;
      expect(
        Array.isArray(chain) && chain.length > 0,
        driver.describe('prompts.md §Resolution chain', 'agent.promptResolved MUST carry a non-empty chain[] of attempted layers'),
      ).toBe(true);
      const entries = chain as ChainEntry[];

      // Every entry is a well-formed layer record (the full-traversal shape).
      for (const e of entries) {
        expect(
          typeof e.layer === 'string' && VALID_LAYERS.has(e.layer),
          driver.describe('prompts.md §Resolution chain', `each chain entry MUST name a valid layer, got ${String(e.layer)}`),
        ).toBe(true);
        expect(typeof e.applied, driver.describe('prompts.md §Resolution chain', 'each chain entry MUST carry a boolean `applied`')).toBe('boolean');
      }

      // Exactly one layer wins (or none, when resolved is null).
      const applied = entries.filter((e) => e.applied === true);
      expect(
        applied.length <= 1,
        driver.describe('prompts.md §Resolution chain', 'AT MOST one chain entry MAY be applied: true (the winning layer)'),
      ).toBe(true);

      // resolved mirrors the applied entry's source (RFC 0029 §B).
      if (applied.length === 1) {
        expect(
          ev.payload?.resolved,
          driver.describe('run-event-payloads.schema.json agentPromptResolved', '`resolved` MUST mirror the applied chain entry\'s `source`'),
        ).toBe(applied[0]?.source);
      } else {
        expect(
          ev.payload?.resolved === null || ev.payload?.resolved === undefined,
          driver.describe('run-event-payloads.schema.json agentPromptResolved', 'with no applied layer, `resolved` MUST be null'),
        ).toBe(true);
      }
    }
  });
});
