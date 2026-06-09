/**
 * RFC 0008 §Conformance — scenario 5/6: memory cap enforcement.
 *
 * Two-part scenario per RFCS/0008-wasm-abi.md §K (resource limits):
 *
 *   1. **Discovery shape (observational, always-on)** — host advertises
 *      `capabilities.nodePackRuntimes.wasm.maxMemoryBytes` as a plausible
 *      integer when WASM is supported.
 *   2. **Positive path (fixture-gated)** — when the deliberately-
 *      misbehaving Rust pack at `examples/packs/rust-misbehaving-memory/`
 *      is built and the host advertises the
 *      `conformance-wasm-pack-memory-cap-breach` fixture, invoking the
 *      `vendor.openwop.misbehaving.memory-bomb` typeId MUST emit
 *      `cap.breached` with `kind: 'wasm-memory'` and drive the run to
 *      terminal `failed`.
 *
 * Until the misbehaving pack ships in a host's fixture set, the positive
 * path soft-skips so the scenario stays green on hosts that haven't
 * wired up the cap-emit behavior yet.
 *
 * @see RFCS/0008-wasm-abi.md §K (resource limits)
 * @see schemas/run-event-payloads.schema.json §"capBreached" (kind enum includes wasm-memory)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const CAP_BREACH_FIXTURE = 'conformance-wasm-pack-memory-cap-breach';

describe('wasm-pack-memory-cap: host advertises maxMemoryBytes', () => {
  it('capabilities.nodePackRuntimes.wasm.maxMemoryBytes is a plausible number', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const wasm =
      capabilityFamily<{ wasm?: Record<string, unknown> }>(disco.json, 'nodePackRuntimes')?.wasm;

    if (!wasm?.supported) return;

    // The cap is REQUIRED to enforce §K. Hosts MUST surface the configured
    // ceiling so clients can size their packs accordingly.
    expect(typeof wasm.maxMemoryBytes, driver.describe(
      'RFCS/0008-wasm-abi.md §K',
      'capabilities.nodePackRuntimes.wasm.maxMemoryBytes MUST be advertised as a number when WASM is supported',
    )).toBe('number');
    if (typeof wasm.maxMemoryBytes === 'number') {
      expect(wasm.maxMemoryBytes).toBeGreaterThanOrEqual(1024 * 1024); // ≥ 1 MiB
      expect(wasm.maxMemoryBytes).toBeLessThanOrEqual(8 * 1024 * 1024 * 1024); // ≤ 8 GiB
    }
  });
});

describe('wasm-pack-memory-cap: positive path via misbehaving pack', () => {
  it('misbehaving pack triggers cap.breached with kind=wasm-memory and terminal failed', async () => {
    if (!isFixtureAdvertised(CAP_BREACH_FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[wasm-pack-memory-cap] fixture ${CAP_BREACH_FIXTURE} not advertised; skipping positive path. ` +
          'Build the misbehaving pack at examples/packs/rust-misbehaving-memory/ and ensure the host serves the fixture.',
      );
      return;
    }
    const disco = await driver.get('/.well-known/openwop');
    const wasm =
      capabilityFamily<{ wasm?: Record<string, unknown> }>(disco.json, 'nodePackRuntimes')?.wasm;
    if (!wasm?.supported) return;

    const create = await driver.post('/v1/runs', {
      workflowId: CAP_BREACH_FIXTURE,
      inputs: {},
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 15_000 });
    expect(terminal.status, driver.describe(
      'RFCS/0008-wasm-abi.md §K',
      'WASM memory-cap breach MUST drive terminal `failed` (RFC 0008 §K: "kill the instance, emit cap.breached")',
    )).toBe('failed');

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: unknown }> }).events ?? [];
    const breachEvent = list.find((e) => e.type === 'cap.breached');
    expect(breachEvent, driver.describe(
      'RFCS/0008-wasm-abi.md §K',
      'host MUST emit cap.breached when a WASM module exceeds its memory ceiling',
    )).toBeDefined();
    // Event detail rides under the canonical `payload` envelope field (per
    // run-event-payloads.schema.json + every other event scenario), not `data`.
    const breachKind = (breachEvent?.payload as { kind?: string } | undefined)?.kind;
    expect(breachKind, driver.describe(
      'RFCS/0008-wasm-abi.md §K',
      'cap.breached payload MUST carry kind: "wasm-memory" for memory-ceiling breaches',
    )).toBe('wasm-memory');
  });
});
