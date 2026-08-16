/**
 * Suite-init setup (RFC 0003).
 *
 * Loaded by vitest via `test.setupFiles` BEFORE any scenario file is
 * imported. Top-level `await` is supported in vitest's setup files so
 * this can fetch the host's `/.well-known/openwop` once and populate the
 * fixture-gating cache; `describe.skipIf(...)` predicates that read
 * `isFixtureAdvertised(...)` then see the populated cache when they
 * register their tests.
 *
 * Behavior matrix:
 *
 *   | OPENWOP_BASE_URL | discovery 200 | fixtures field | result |
 *   |---|---|---|---|
 *   | unset        | n/a            | n/a             | empty cache (offline mode) |
 *   | set          | yes            | absent/empty    | empty cache (host advertises none) |
 *   | set          | yes            | non-empty       | populated cache |
 *   | set          | non-200 / err  | n/a             | empty cache + console warning |
 *
 * "Empty cache" means every fixture-dependent scenario skips. That is
 * the correct outcome for a host that doesn't advertise the fixture
 * surface — see RFC 0003 §"Implementation notes."
 *
 * This file is intentionally side-effect-only. Do NOT add `describe`/
 * `it` here; vitest treats setupFiles differently from scenario files.
 */

import { setAdvertisedFixtures } from './lib/fixtures.js';
import { setMultiAgentCapabilities } from './lib/multi-agent-capabilities.js';
import { OtelCollector, setCollector } from './lib/otel-collector.js';
import { McpFakeServer, setMcpFakeServer } from './lib/mcp-fake-server.js';
import { A2AFakePeer, setA2AFakePeer } from './lib/a2a-fake-peer.js';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { basename } from 'node:path';
import { recordRequirement, journalLength, journalSince } from './lib/requirement-ledger.js';
import { fileDisposition, requirementIdForFile, type FileTestState } from './lib/scenario-disposition.js';
import type { DiscoveryPayload } from './lib/profiles.js';

const SUITE_INIT_TIMEOUT_MS = 5_000;

async function loadHostFixtures(): Promise<void> {
  const baseUrl = process.env.OPENWOP_BASE_URL?.trim();
  if (!baseUrl) {
    // Offline / fixture-stub-only run. No host to ask; treat as "host
    // advertises no fixtures" so all fixture-dependent scenarios skip.
    setAdvertisedFixtures(null);
    setMultiAgentCapabilities(null);
    return;
  }

  const normalizedBase = baseUrl.replace(/\/$/, '');
  const url = `${normalizedBase}/.well-known/openwop`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUITE_INIT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[openwop-conformance setup] discovery fetch returned ${res.status}; ` +
          `treating host as advertising no fixtures. Fixture-dependent scenarios will skip.`,
      );
      setAdvertisedFixtures(null);
    setMultiAgentCapabilities(null);
      return;
    }
    const body = (await res.json()) as DiscoveryPayload;
    setAdvertisedFixtures(body);
    setMultiAgentCapabilities(body);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[openwop-conformance setup] discovery fetch failed (${(err as Error).message ?? 'unknown'}); ` +
        `treating host as advertising no fixtures. Fixture-dependent scenarios will skip.`,
    );
    setAdvertisedFixtures(null);
    setMultiAgentCapabilities(null);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OTel collector lifecycle (Track 11).
 *
 * Opt-in: only starts when `OPENWOP_OTEL_COLLECTOR=true` is set. Hosts
 * that don't claim observability conformance skip the scenarios; hosts
 * that do MUST be configured with
 * `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>` and
 * `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` before startup. The chosen
 * port is exposed via `OPENWOP_OTEL_COLLECTOR_PORT` (read by scenarios
 * for diagnostics) and printed to stderr at suite init.
 */
async function maybeStartOtelCollector(): Promise<void> {
  if (process.env.OPENWOP_OTEL_COLLECTOR !== 'true') {
    setCollector(null);
    return;
  }
  const portEnv = process.env.OPENWOP_OTEL_COLLECTOR_PORT;
  const requestedPort = portEnv ? Number(portEnv) : 4318;
  const collector = new OtelCollector();
  try {
    await collector.start(requestedPort);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[openwop-conformance setup] OTel collector failed to bind on port ${requestedPort} ` +
        `(${(err as Error).message ?? 'unknown'}); falling back to ephemeral port.`,
    );
    await collector.start(0);
  }
  setCollector(collector);
  // eslint-disable-next-line no-console
  console.error(
    `[openwop-conformance setup] OTel collector listening at ${collector.endpoint()}. ` +
      `Configure the host with OTEL_EXPORTER_OTLP_ENDPOINT=${collector.endpoint()} ` +
      `and OTEL_EXPORTER_OTLP_PROTOCOL=http/json.`,
  );

  // Track 11 — opt into the parallel OTLP/gRPC collector when
  // `OPENWOP_OTEL_COLLECTOR_GRPC=true`. Same span/metric store; hosts
  // emitting via either transport surface in `getCollector().spans()`.
  if (process.env.OPENWOP_OTEL_COLLECTOR_GRPC === 'true') {
    const grpcPortEnv = process.env.OPENWOP_OTEL_COLLECTOR_GRPC_PORT;
    const grpcRequestedPort = grpcPortEnv ? Number(grpcPortEnv) : 4317;
    try {
      await collector.startGrpc(grpcRequestedPort);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[openwop-conformance setup] OTLP/gRPC collector failed to bind on port ${grpcRequestedPort} ` +
          `(${(err as Error).message ?? 'unknown'}); falling back to ephemeral port.`,
      );
      await collector.startGrpc(0);
    }
    // eslint-disable-next-line no-console
    console.error(
      `[openwop-conformance setup] OTLP/gRPC collector listening at ${collector.grpcEndpoint()}. ` +
        `Configure the host with OTEL_EXPORTER_OTLP_ENDPOINT=${collector.grpcEndpoint()} ` +
        `and OTEL_EXPORTER_OTLP_PROTOCOL=grpc.`,
    );
  }
}

/**
 * MCP fake-server lifecycle (Track 6).
 *
 * Opt-in: only starts when `OPENWOP_MCP_FAKE_SERVER=true`. Operator
 * configures the host to use the printed URL as one of its MCP servers
 * (e.g., via host-specific config — the wire transport is normative
 * but how the host registers servers is not).
 */
async function maybeStartMcpFakeServer(): Promise<void> {
  if (process.env.OPENWOP_MCP_FAKE_SERVER !== 'true') {
    setMcpFakeServer(null);
    return;
  }
  const portEnv = process.env.OPENWOP_MCP_FAKE_SERVER_PORT;
  const requestedPort = portEnv ? Number(portEnv) : 0;
  const server = new McpFakeServer();
  await server.start(requestedPort);
  setMcpFakeServer(server);
  // eslint-disable-next-line no-console
  console.error(
    `[openwop-conformance setup] MCP fake server listening at ${server.endpoint()}. ` +
      `Configure the host's MCP integration to use this URL.`,
  );
}

/**
 * A2A fake peer lifecycle (Track 6).
 *
 * Opt-in via `OPENWOP_A2A_FAKE_PEER=true`. Operator configures the host
 * to consume the printed AgentCard URL.
 */
async function maybeStartA2AFakePeer(): Promise<void> {
  if (process.env.OPENWOP_A2A_FAKE_PEER !== 'true') {
    setA2AFakePeer(null);
    return;
  }
  const portEnv = process.env.OPENWOP_A2A_FAKE_PEER_PORT;
  const requestedPort = portEnv ? Number(portEnv) : 0;
  // Dual-era since 1.112.0. Order = card shape for a header-less GET (first
  // wins); both eras are spoken on the RPC path. Default keeps the 0.3 card so
  // today's 0.3 clients (which read `card.url`) keep working; set
  // OPENWOP_A2A_FAKE_PEER_VERSIONS=1.0,0.3 to serve the 1.0 card by default.
  const versionsEnv = process.env.OPENWOP_A2A_FAKE_PEER_VERSIONS;
  const versions = versionsEnv
    ? (versionsEnv.split(',').map((v) => v.trim()).filter((v) => v === '1.0' || v === '0.3') as Array<'1.0' | '0.3'>)
    : undefined;
  const peer = new A2AFakePeer(versions && versions.length > 0 ? { protocolVersions: versions } : undefined);
  await peer.start(requestedPort);
  setA2AFakePeer(peer);
  // eslint-disable-next-line no-console
  console.error(
    `[openwop-conformance setup] A2A fake peer listening at ${peer.endpoint()}. ` +
      `AgentCard at ${peer.endpoint()}/.well-known/agent-card.json.`,
  );
}

await loadHostFixtures();
await maybeStartOtelCollector();
await maybeStartMcpFakeServer();
await maybeStartA2AFakePeer();

// ─── RFC 0148 §A file-level disposition recording (S6, acceptance item 2) ─────
//
// Every scenario FILE records exactly one disposition for its own requirement
// id when it finishes. `afterEach` collects per-test states; `afterAll` folds
// them (fileDisposition) and records — `executed-fail` / `executed-pass` /
// `inapplicable` or `skipped` (when a behaviorGate in the file recorded that
// reason for the profile it gates on) / else `blocked` (an all-skipped file
// with no reason is an unclassified return, and §A resolves it to blocked).
// When the runner set OPENWOP_LEDGER_PATH the recording also lands in the JSONL
// sink, which is how `--certify` gets requirement-level dispositions instead of
// inferring them from per-file pass/fail/skip.
//
// Setup-file hooks apply to every file in the worker; state is keyed by file.
const _fileStates = new Map<string, FileTestState[]>();
const _fileAssertions = new Map<string, number>();
const _ledgerMarks = new Map<string, number>();
function _fileOf(task: { file?: { filepath?: string; name?: string } } | undefined): string | null {
  const f = task?.file?.filepath ?? task?.file?.name;
  return typeof f === 'string' && f.length > 0 ? basename(f) : null;
}
beforeAll(({}, suite) => {
  // Mark the ledger journal BEFORE the file's tests run, so a behaviorGate
  // decision made by the very first test is inside the file's window.
  const s = suite as unknown as { filepath?: string; name?: string; file?: { filepath?: string; name?: string } };
  const file = _fileOf({ file: s.file ?? s });
  if (file !== null && !_ledgerMarks.has(file)) _ledgerMarks.set(file, journalLength());
});
afterEach(({ task }) => {
  const file = _fileOf(task as { file?: { filepath?: string; name?: string } });
  if (file === null) return;
  if (!_ledgerMarks.has(file)) _ledgerMarks.set(file, 0);
  const state = task.result?.state;
  const arr = _fileStates.get(file) ?? [];
  arr.push(state === 'pass' ? 'pass' : state === 'fail' ? 'fail' : 'skip');
  _fileStates.set(file, arr);
  // RFC 0148 §C assertionCount: how many `expect` calls this test actually made.
  // A leg that early-returns from a gate makes zero, and a file of such legs is
  // an `executed-pass` with assertionCount 0 — visible, and unclassified for a
  // claimed floor.
  let calls = 0;
  try {
    calls = (expect.getState() as { assertionCalls?: number }).assertionCalls ?? 0;
  } catch {
    /* no state — count 0 */
  }
  _fileAssertions.set(file, (_fileAssertions.get(file) ?? 0) + calls);
});
afterAll(({}, suite) => {
  // vitest 4: the suite/file task is the SECOND argument. For a file-level
  // afterAll registered from a setup file, `suite` is the File task itself.
  const s = suite as unknown as { filepath?: string; name?: string; file?: { filepath?: string; name?: string } };
  const file = _fileOf({ file: s.file ?? s });
  if (file === null || !file.endsWith('.test.ts')) return;
  const states = _fileStates.get(file) ?? [];
  // Did a behaviorGate in this file record inapplicable/skipped for its profile?
  const mark = _ledgerMarks.get(file) ?? 0;
  const since = journalSince(mark);
  const gateReason = since.some((e) => e.disposition === 'inapplicable')
    ? 'inapplicable'
    : since.some((e) => e.disposition === 'skipped')
      ? 'skipped'
      : undefined;
  const assertionCount = _fileAssertions.get(file) ?? 0;
  const { disposition, detail } = fileDisposition(states, gateReason, assertionCount);
  try {
    recordRequirement(requirementIdForFile(file), disposition, detail, { assertionCount });
  } catch {
    /* a scenario that recorded its own file id first wins; never fail the file for bookkeeping */
  }
  _fileStates.delete(file);
  _fileAssertions.delete(file);
  _ledgerMarks.delete(file);
});

