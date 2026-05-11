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
  const peer = new A2AFakePeer();
  await peer.start(requestedPort);
  setA2AFakePeer(peer);
  // eslint-disable-next-line no-console
  console.error(
    `[openwop-conformance setup] A2A fake peer listening at ${peer.endpoint()}. ` +
      `AgentCard at ${peer.endpoint()}/agent.json.`,
  );
}

await loadHostFixtures();
await maybeStartOtelCollector();
await maybeStartMcpFakeServer();
await maybeStartA2AFakePeer();
