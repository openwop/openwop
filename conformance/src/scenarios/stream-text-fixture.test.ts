/**
 * stream-text-fixture — `stream-modes.md` §`messages` end-to-end through the
 * deterministic `stream-text` mock provider. Consumer of the
 * `conformance-stream-text` fixture (closes catalog gap F1 — the fixture
 * previously had no consuming scenario; see `fixtures.md`).
 *
 * Gating: `describe.skipIf` on the advertised `conformance-stream-text`
 * fixture id (RFC 0003). Inside the test, a host that advertises the
 * fixture but not the `stream-text` mock provider
 * (`Capabilities.testing.mockProviders`) soft-skips with a warning —
 * fixtures.md lets hosts mark this fixture optional until the
 * mock-provider extension lands. `403 mock_provider_forbidden` (a
 * production-scoped key) also soft-skips honestly.
 *
 * What's asserted per the fixture driver (`fixtures.md` §`conformance-stream-text`):
 *   1. `?streamMode=messages` delivers the mocked tokens
 *      `["Hello", " ", "world", "!"]` as `ai.message.chunk` events in
 *      token order (the documented fold behavior).
 *   2. The final chunk carries `isLast: true`,
 *      `meta.finishReason === "stop"`, and
 *      `meta.usage.completionTokens === 4` — the `{nodeId, runId, chunk,
 *      isLast}` minimum compliant payload per stream-modes.md §messages
 *      (single-sourced by RFC 0094 §D).
 *   3. The SSE stream is server-closed on terminal (not timed out).
 *   4. The run reaches terminal `completed`.
 *   5. Negative: an unknown `mockProvider.id` is rejected with
 *      `400 unsupported_mock_provider`.
 *
 * @see spec/v1/stream-modes.md §`messages`
 * @see conformance/fixtures.md §`conformance-stream-text`
 * @see RFCS/0094-wire-shape-reconciliation.md §D
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { subscribe } from '../lib/sse.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const FIXTURE_ID = 'conformance-stream-text';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(FIXTURE_ID);

const MOCK_TOKENS = ['Hello', ' ', 'world', '!'];

interface ChunkPayload {
  readonly nodeId?: unknown;
  readonly runId?: unknown;
  readonly chunk?: unknown;
  readonly isLast?: unknown;
  readonly meta?: {
    readonly finishReason?: unknown;
    readonly usage?: { readonly completionTokens?: unknown };
  };
}

function errCode(json: unknown): string | undefined {
  const e = (json as { error?: unknown } | undefined)?.error;
  return typeof e === 'string' ? e : undefined;
}

async function createMockRun(mockProviderId: string): Promise<OpenWOPResponse> {
  return driver.post('/v1/runs', {
    workflowId: FIXTURE_ID,
    configurable: {
      mockProvider: {
        id: mockProviderId,
        config: {
          tokens: MOCK_TOKENS,
          delayMsPerToken: 10,
          finishReason: 'stop',
          usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 },
        },
      },
    },
  });
}

/** True when the host advertises the v1-mandatory `stream-text` mock
 *  provider in `Capabilities.testing.mockProviders`. */
async function isStreamTextMockAdvertised(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return false;
  const testing = capabilityFamily<{ mockProviders?: unknown }>(res.json, 'testing');
  return Array.isArray(testing?.mockProviders) && testing.mockProviders.includes('stream-text');
}

describe.skipIf(SKIP_NO_FIXTURE)('stream-text-fixture: messages-mode fold through the stream-text mock (F1)', () => {
  it('delivers the mocked tokens in order, terminates with isLast + meta, and server-closes', async () => {
    if (!(await isStreamTextMockAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn(
        '[stream-text-fixture] host does not advertise the stream-text mock provider ' +
          '(Capabilities.testing.mockProviders); skipping',
      );
      return;
    }

    const create = await createMockRun('stream-text');
    if (create.status === 403 && errCode(create.json) === 'mock_provider_forbidden') {
      // eslint-disable-next-line no-console
      console.warn('[stream-text-fixture] API key is production-scoped (403 mock_provider_forbidden); skipping');
      return;
    }
    expect(
      create.status,
      driver.describe(
        'fixtures.md §conformance-stream-text',
        'a test key MUST be able to start the fixture with configurable.mockProvider',
      ),
    ).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=messages`,
      { timeoutMs: 15_000 },
    );

    // 3) server-closed, not timeout.
    expect(
      result.closedBy,
      driver.describe('stream-modes.md §messages', 'server MUST close the messages stream on terminal run status'),
    ).toBe('server');

    // Collect ai.message.chunk payloads. Per stream-modes.md the SSE event
    // type IS ai.message.chunk; tolerate hosts that wrap the payload under
    // a `payload` envelope (the RunEventDoc shape).
    const chunks: ChunkPayload[] = [];
    for (const e of result.events) {
      if (e.event !== 'ai.message.chunk') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        continue;
      }
      const direct = parsed as ChunkPayload & { payload?: ChunkPayload };
      chunks.push(typeof direct.chunk === 'string' ? direct : (direct.payload ?? direct));
    }

    expect(
      chunks.length,
      driver.describe(
        'stream-modes.md §messages',
        'messages mode MUST emit ai.message.chunk SSE events for the streaming AI node',
      ),
    ).toBe(MOCK_TOKENS.length);

    // 1) Token order matches the mock config exactly.
    expect(
      chunks.map((c) => c.chunk),
      driver.describe(
        'fixtures.md §conformance-stream-text',
        'chunk arrival order MUST match the mock token order',
      ),
    ).toEqual(MOCK_TOKENS);

    // 2) Final-chunk contract: isLast + Tier 1 meta.
    const last = chunks[chunks.length - 1]!;
    expect(
      last.isLast,
      driver.describe(
        'stream-modes.md §messages + RFC 0094 §D',
        'the final ai.message.chunk MUST carry isLast: true',
      ),
    ).toBe(true);
    expect(
      last.meta?.finishReason,
      driver.describe('stream-modes.md §messages (Tier 1)', 'final chunk meta.finishReason MUST be "stop"'),
    ).toBe('stop');
    expect(
      last.meta?.usage?.completionTokens,
      driver.describe('stream-modes.md §messages (Tier 1)', 'final chunk meta.usage.completionTokens MUST echo the mock usage'),
    ).toBe(4);

    // Minimum compliant payload fields are present on every chunk.
    for (const c of chunks) {
      expect(typeof c.nodeId, driver.describe('run-event-payloads.schema.json §outputChunk', 'nodeId MUST be a string')).toBe('string');
      expect(typeof c.runId, driver.describe('run-event-payloads.schema.json §outputChunk', 'runId MUST be a string')).toBe('string');
      expect(typeof c.isLast, driver.describe('run-event-payloads.schema.json §outputChunk', 'isLast MUST be a boolean')).toBe('boolean');
    }

    // 4) Terminal completed.
    const terminal = await pollUntilTerminal(runId);
    expect(
      terminal.status,
      driver.describe('fixtures.md §conformance-stream-text', 'the fixture run MUST reach terminal completed'),
    ).toBe('completed');
  });

  it('an unknown mockProvider.id is rejected with 400 unsupported_mock_provider', async () => {
    if (!(await isStreamTextMockAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn('[stream-text-fixture] stream-text mock not advertised; skipping negative leg');
      return;
    }
    const create = await createMockRun('does-not-exist');
    if (create.status === 403 && errCode(create.json) === 'mock_provider_forbidden') {
      // eslint-disable-next-line no-console
      console.warn('[stream-text-fixture] API key is production-scoped; skipping negative leg');
      return;
    }
    expect(
      create.status,
      driver.describe('fixtures.md §conformance-stream-text', 'an unknown mockProvider.id MUST be rejected with 400'),
    ).toBe(400);
    expect(
      errCode(create.json),
      driver.describe('fixtures.md §conformance-stream-text', 'the refusal MUST carry the canonical unsupported_mock_provider code'),
    ).toBe('unsupported_mock_provider');
  });
});
