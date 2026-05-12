/**
 * core.mcp.toolCall smoke for the Postgres reference host (Phase H.2).
 *
 * Spins up the conformance suite's synthetic MCP fake server, points
 * the host at it via OPENWOP_MCP_SERVER_<ID>, and exercises:
 *
 *   1. Discovery advertises `capabilities.mcpClient.supported: true`.
 *   2. `callMcpTool` against the fake server returns the echoed text.
 *   3. `summarizeForEventLog` produces a redaction-safe summary
 *      (MCP-1 invariant — no raw args / no raw result on summary).
 *   4. `mcp_server_not_configured` when serverId has no env mapping.
 *   5. Trust marker `contentTrust: "untrusted"` per
 *      threat-model-prompt-injection.md §UNTRUSTED.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-mcp-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.js';
import type { Querier, QueryResult } from '../src/db.js';
import { McpFakeServer } from '../../../../conformance/src/lib/mcp-fake-server.js';
import {
  callMcpTool,
  summarizeForEventLog,
  McpClientError,
} from '../src/mcp-client.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

async function main(): Promise<void> {
  const fake = new McpFakeServer();
  await fake.start();
  process.env.OPENWOP_MCP_SERVER_PROBE = fake.endpoint();

  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Discovery advertises mcpClient.
    const disco = await fetch(`${baseUrl}/.well-known/openwop`);
    const discoBody = (await disco.json()) as {
      capabilities?: {
        mcpClient?: {
          supported?: boolean;
          transports?: string[];
          trustBoundary?: string;
        };
      };
    };
    assert.equal(discoBody.capabilities?.mcpClient?.supported, true);
    assert.deepEqual(discoBody.capabilities?.mcpClient?.transports, ['http+jsonrpc']);
    assert.equal(discoBody.capabilities?.mcpClient?.trustBoundary, 'untrusted');

    // 2. Tool roundtrip against fake server.
    const result = await callMcpTool({
      serverId: 'probe',
      toolName: 'echo',
      arguments: { text: 'h2-canary-probe' },
    });
    assert.equal(result.isError, false);
    assert.equal(result.contentTrust, 'untrusted',
      'contentTrust MUST be "untrusted" per threat-model-prompt-injection §UNTRUSTED');
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0]?.type, 'text');
    assert.equal((result.content[0] as { text?: string }).text, 'h2-canary-probe');
    assert.ok(result.durationMs >= 0);

    // 3. Summary is redaction-safe (no raw args, no raw result content).
    const summary = summarizeForEventLog(
      { serverId: 'probe', toolName: 'echo', arguments: { text: 'h2-canary-probe' } },
      result,
    );
    const summaryDump = JSON.stringify(summary);
    assert.equal(summaryDump.includes('h2-canary-probe'), false,
      'MCP-1: summary MUST NOT include raw tool arguments or result text');
    assert.match(summary.argumentsSha256, /^[0-9a-f]{64}$/);
    assert.match(summary.resultSha256, /^[0-9a-f]{64}$/);
    assert.ok(summary.resultLength > 0);
    assert.equal(summary.toolName, 'echo');
    assert.equal(summary.serverId, 'probe');
    assert.equal(summary.isError, false);

    // 4. Unconfigured serverId → mcp_server_not_configured.
    try {
      await callMcpTool({ serverId: 'does-not-exist', toolName: 'echo', arguments: {} });
      assert.fail('unconfigured serverId MUST throw');
    } catch (err: unknown) {
      assert.ok(err instanceof McpClientError);
      assert.equal((err as McpClientError).code, 'mcp_server_not_configured');
    }

    // 5. Verify the MCP fake server saw the initialize + tools/call calls.
    const invocations = fake.invocations();
    assert.ok(invocations.length >= 2);
    assert.equal(invocations[0]?.method, 'initialize');
    assert.equal(invocations[1]?.method, 'tools/call');

    // eslint-disable-next-line no-console
    console.log('ok mcp-client — H.2 verified (5 paths + MCP-1 redaction + UNTRUSTED marker)');
  } finally {
    await close();
    await fake.stop();
    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
