/**
 * TypeScript smoke for @openwop/openwop.
 *
 * Exercises the wire round-trip against a running SQLite reference host:
 *   1. Capability discovery (unauthenticated)
 *   2. Run create + terminal poll for `conformance-noop`
 *   3. Error envelope on unknown workflowId
 *
 * Exits non-zero on any contract violation. Run from repo root with the
 * SQLite host listening on 127.0.0.1:3838 (default `OPENWOP_BASE_URL`).
 */

import { OpenwopClient, WopError, isTerminalRunStatus } from '../typescript/src/index.js';

const BASE_URL = process.env.OPENWOP_BASE_URL ?? 'http://127.0.0.1:3838';
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-sqlite-dev-key';
const FIXTURE = 'conformance-noop';

function fail(msg: string): never {
  console.error(`[smoke-ts] FAIL: ${msg}`);
  process.exit(1);
}

async function pollTerminal(client: OpenwopClient, runId: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snap = await client.runs.get(runId);
    if (isTerminalRunStatus(snap.status)) return snap.status;
    await new Promise((r) => setTimeout(r, 50));
  }
  fail(`run ${runId} did not terminate within 10s`);
}

async function main(): Promise<void> {
  const client = new OpenwopClient({ baseUrl: BASE_URL, apiKey: API_KEY });

  // 1. Discovery
  const caps = await client.discovery.capabilities();
  if (caps.protocolVersion !== '1.0') fail(`protocolVersion ${caps.protocolVersion} != 1.0`);

  // 2. Run + poll
  const create = await client.runs.create({ workflowId: FIXTURE });
  if (!create.runId) fail('runs.create did not return runId');
  if (!create.eventsUrl) fail('runs.create did not return eventsUrl');
  const terminal = await pollTerminal(client, create.runId);
  if (terminal !== 'completed') fail(`terminal status ${terminal} != completed`);

  // 3. Error envelope on bad workflow
  try {
    await client.runs.create({ workflowId: '__does_not_exist__' });
    fail('expected WopError for unknown workflow');
  } catch (err) {
    if (!(err instanceof WopError)) fail(`expected WopError, got ${err}`);
    if (err.status !== 404 && err.status !== 400) {
      fail(`expected 404 or 400 for unknown workflow, got ${err.status}`);
    }
  }

  console.log('[smoke-ts] PASS');
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
