#!/usr/bin/env node
/**
 * Promote the it.todo() placeholder scenarios from RFCs 0014-0020 to live
 * advertisement-shape assertions. fs-path-traversal.test.ts already landed
 * via hand-edit; this script regenerates every OTHER placeholder so they
 * stop printing skip-warnings in CI and start verifying the capability
 * advertisement shape against any host that boots the conformance suite.
 *
 * What "live advertisement-shape assertions" means:
 *   - Read `/.well-known/openwop`.
 *   - When `capabilities.<key>` is absent, every assertion soft-skips.
 *   - When `capabilities.<key>` is present, assert it's a well-formed
 *     object with the expected sub-fields per the RFC.
 *   - Behavioral assertions (cross-tenant, atomicity) stay it.todo()
 *     because they require a deployment-level test seam each host wires
 *     differently. Those promote later when a reference host wires them.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('conformance', 'src', 'scenarios');

const SCENARIOS = {
  // RFC 0015 host.kvStorage
  'kv-cross-tenant-isolation.test.ts': {
    rfc: '0015', cap: 'kvStorage', shape: 'kv',
    summary: 'host.kvStorage MUST partition values by tenant. Cross-tenant reads MUST return not-found.',
    note: 'Behavioral cross-tenant proof needs a two-tenant test seam; assertion stays it.todo() until a reference host exposes one.',
    behavioralTodos: [
      'set under tenant A → get under tenant B with same key returns found:false',
      'list under tenant B does not include keys set under tenant A',
    ],
  },
  'kv-atomic-increment.test.ts': {
    rfc: '0015', cap: 'kvStorage', shape: 'kvAtomic',
    summary: 'Atomic increment MUST be atomic across concurrent callers.',
    behavioralTodos: [
      '1000 concurrent +1 increments → final value is 1000',
    ],
  },
  'kv-cas.test.ts': {
    rfc: '0015', cap: 'kvStorage', shape: 'kvCas',
    summary: 'Compare-and-swap MUST be atomic — stale expect rejected.',
    behavioralTodos: [
      'CAS with matching expect succeeds and updates value',
      'CAS with stale expect fails with swapped:false and returns actual',
    ],
  },
  'kv-ttl-expiry.test.ts': {
    rfc: '0015', cap: 'kvStorage', shape: 'kv',
    summary: 'TTL honored with at most a 1-second drift on expiry visibility.',
    behavioralTodos: [
      'set with ttl=2 → get at t+1 returns the value; get at t+3 returns not-found',
    ],
  },
  // RFC 0016 host.tableStorage
  'table-cross-tenant-isolation.test.ts': {
    rfc: '0016', cap: 'tableStorage', shape: 'table',
    summary: 'host.tableStorage MUST partition rows by tenant.',
    behavioralTodos: [
      'insert under tenant A → query under tenant B returns 0 rows for the same table+filter',
    ],
  },
  'table-cursor-pagination.test.ts': {
    rfc: '0016', cap: 'tableStorage', shape: 'table',
    summary: 'query MUST support filter + cursor pagination.',
    behavioralTodos: [
      'first page returns N rows + nextCursor; second page resumes; final page returns nextCursor=null',
    ],
  },
  'table-schema-enforcement.test.ts': {
    rfc: '0016', cap: 'tableStorage', shape: 'table',
    summary: 'Subsequent rows MUST conform to the schema established on first insert.',
    behavioralTodos: [
      'first insert declares schema; subsequent insert with wrong column type is rejected',
    ],
  },
  // RFC 0017 host.queueBus
  'queue-publish-consume-roundtrip.test.ts': {
    rfc: '0017', cap: 'queueBus', shape: 'queueBus',
    summary: 'publish + consume + ack roundtrip.',
    behavioralTodos: [
      'publish → consume returns the message with the right payload + headers',
      'ack removes the message; subsequent consume returns not-found within timeout',
    ],
  },
  'queue-cross-tenant-isolation.test.ts': {
    rfc: '0017', cap: 'queueBus', shape: 'queueBus',
    summary: 'host.queueBus MUST partition messages by tenant.',
    behavioralTodos: [
      'publish under tenant A on topic T → consume under tenant B on topic T returns not-found',
    ],
  },
  'queue-ack-nack-dlq.test.ts': {
    rfc: '0017', cap: 'queueBus', shape: 'queueBusDlq',
    summary: 'nack returns for redelivery; deadLetter routes to the configured DLQ.',
    behavioralTodos: [
      'nack(requeue=true) → message is redelivered on next consume',
      'deadLetter → message appears on the configured DLQ',
    ],
  },
  'stream-subscribe-from-beginning.test.ts': {
    rfc: '0017', cap: 'queueBus', shape: 'queueBusStream',
    summary: 'Stream subscribers with fromBeginning=true receive records published before subscription.',
    behavioralTodos: [
      'publish 5 records then subscribe(fromBeginning=true) → consumer receives all 5',
    ],
  },
  // RFC 0018 host.sql / vector / search
  'sql-injection-rejection.test.ts': {
    rfc: '0018', cap: 'sql', shape: 'sql',
    summary: 'host.sql MUST reject non-parametric queries that inline user input.',
    behavioralTodos: [
      "query({ sql: \"SELECT * FROM users WHERE id = '\" + userInput + \"'\", params: [] }) is rejected",
      "query({ sql: 'SELECT * FROM users WHERE id = ?', params: [userInput] }) succeeds",
    ],
  },
  'sql-transaction-atomicity.test.ts': {
    rfc: '0018', cap: 'sql', shape: 'sqlTx',
    summary: 'transactions MUST be atomic; partial failure rolls back.',
    behavioralTodos: [
      'transaction with N statements where N-th fails → no rows from earlier statements visible',
    ],
  },
  'vector-knn-roundtrip.test.ts': {
    rfc: '0018', cap: 'vectorStore', shape: 'vector',
    summary: 'upsert then query returns the same vectors in top-k order.',
    behavioralTodos: [
      'upsert 10 vectors → query with one of them returns it as top-1',
      'topK respects the configured limit',
    ],
  },
  'search-bm25-roundtrip.test.ts': {
    rfc: '0018', cap: 'searchIndex', shape: 'search',
    summary: 'index then query returns relevant documents.',
    behavioralTodos: [
      'index 3 docs → query returns relevance-ranked hits',
    ],
  },
  // RFC 0019 host.blobStorage + host.cache
  'blob-roundtrip.test.ts': {
    rfc: '0019', cap: 'blobStorage', shape: 'blob',
    summary: 'put then get returns the same content + size + etag.',
    behavioralTodos: [
      'put binary content → get returns identical bytes',
      'get of non-existent key returns found:false',
    ],
  },
  'blob-presign-expiry.test.ts': {
    rfc: '0019', cap: 'blobStorage', shape: 'blobPresign',
    summary: 'Presigned URLs MUST expire at the advertised TTL.',
    behavioralTodos: [
      'presign with ttl=60 → URL works during the window, returns 403 after',
    ],
  },
  'blob-cross-tenant-isolation.test.ts': {
    rfc: '0019', cap: 'blobStorage', shape: 'blob',
    summary: 'host.blobStorage MUST isolate by tenant per bucket.',
    behavioralTodos: [
      'put under tenant A → get under tenant B with same key returns found:false',
    ],
  },
  'cache-ttl-expiry.test.ts': {
    rfc: '0019', cap: 'cache', shape: 'cache',
    summary: 'Cache TTL honored with at most 1-second drift.',
    behavioralTodos: [
      'put with ttl=2 → hit within window; miss after',
    ],
  },
  'cache-cross-tenant-isolation.test.ts': {
    rfc: '0019', cap: 'cache', shape: 'cache',
    summary: 'Cache entries scoped per tenant.',
    behavioralTodos: [
      'put under tenant A → get under tenant B returns miss',
    ],
  },
  // RFC 0020 host.mcp.serverMount
  'mcp-server-tool-roundtrip.test.ts': {
    rfc: '0020', cap: 'mcp', shape: 'mcpServerMount',
    summary: 'External MCP client discovers and invokes a workflow exposed via core.openwop.mcp.expose-tool.',
    behavioralTodos: [
      'tools/list returns the exposed workflow',
      'tools/call with valid arguments completes the run and returns CallToolResult',
    ],
  },
  'mcp-server-resource-roundtrip.test.ts': {
    rfc: '0020', cap: 'mcp', shape: 'mcpServerMount',
    summary: 'External client lists + reads an exposed resource.',
    behavioralTodos: [
      'resources/list returns the exposed resource',
      'resources/read returns the bound content',
    ],
  },
  'mcp-server-prompt-roundtrip.test.ts': {
    rfc: '0020', cap: 'mcp', shape: 'mcpServerMount',
    summary: 'External client lists + retrieves an exposed prompt template.',
    behavioralTodos: [
      'prompts/list returns the exposed prompt',
      'prompts/get with arguments returns the rendered messages',
    ],
  },
  'mcp-server-sampling-bridge.test.ts': {
    rfc: '0020', cap: 'mcp', shape: 'mcpServerMountSampling',
    summary: 'Inbound sampling/createMessage routes through the workflow-chosen LLM (BYOK consent preserved).',
    behavioralTodos: [
      'sampling/createMessage from external server is bridged to ctx.callAI and the result is returned',
    ],
  },
  'mcp-server-elicitation-bridge.test.ts': {
    rfc: '0020', cap: 'mcp', shape: 'mcpServerMountElicitation',
    summary: 'Inbound elicitation/create suspends the run on a typed form and resumes on accept/decline/cancel.',
    behavioralTodos: [
      'elicitation/create with a flat schema suspends the run',
      'accept response resumes with payload; decline + cancel paths round-trip correctly',
    ],
  },
  'mcp-server-untrusted-args.test.ts': {
    rfc: '0020', cap: 'mcp', shape: 'mcpServerMount',
    summary: 'tools/call.arguments MUST validate against the declared inputSchema before workflow start.',
    behavioralTodos: [
      'tools/call with arguments missing a required field is rejected with isError:true',
      'tools/call with arguments containing wrong types is rejected before the run starts',
    ],
  },
};

// Each "shape" describes what to assert about the advertisement.
// We assert the capability is either absent or a well-formed object.
const SHAPES = {
  kv: { path: 'kvStorage', required: ['supported'] },
  kvAtomic: { path: 'kvStorage', required: ['supported'], subPath: 'atomicIncrement', subRequired: 'boolean' },
  kvCas: { path: 'kvStorage', required: ['supported'], subPath: 'compareAndSwap', subRequired: 'boolean' },
  table: { path: 'tableStorage', required: ['supported'] },
  queueBus: { path: 'queueBus', required: ['supported'] },
  queueBusDlq: { path: 'queueBus', required: ['supported'], subPath: 'deadLetterSupported', subRequired: 'boolean' },
  queueBusStream: { path: 'queueBus', required: ['supported'], subPath: 'stream.supported', subRequired: 'boolean' },
  sql: { path: 'sql', required: ['supported'] },
  sqlTx: { path: 'sql', required: ['supported'], subPath: 'transactions', subRequired: 'boolean' },
  vector: { path: 'vectorStore', required: ['supported'] },
  search: { path: 'searchIndex', required: ['supported'] },
  blob: { path: 'blobStorage', required: ['supported'] },
  blobPresign: { path: 'blobStorage', required: ['supported'], subPath: 'presignSupported', subRequired: 'boolean' },
  cache: { path: 'cache', required: ['supported'] },
  mcpServerMount: { path: 'mcp.serverMount', required: ['supported'] },
  mcpServerMountSampling: { path: 'mcp.serverMount', required: ['supported'], subPath: 'samplingBridge', subRequired: 'boolean' },
  mcpServerMountElicitation: { path: 'mcp.serverMount', required: ['supported'], subPath: 'elicitationBridge', subRequired: 'boolean' },
};

function fileBody(file, def) {
  const shape = SHAPES[def.shape];
  const pathParts = shape.path.split('.');
  // Bracket-access with `as Record<string, unknown> | undefined` so nested
  // optional-chains don't require us to model the full Capabilities type.
  const accessor =
    'body?.capabilities as Record<string, unknown> | undefined;\n' +
    pathParts.map((p, i) => {
      const prev = i === 0 ? 'top' : 'cur';
      const next = i === pathParts.length - 1 ? 'final' : 'cur';
      return `  const ${next} = (${prev} && typeof ${prev} === 'object') ? (${prev} as Record<string, unknown>)[${JSON.stringify(p)}] : undefined;`;
    }).join('\n');
  const advName = pathParts.join('.');
  const title = file.replace('.test.ts', '');
  const subAssert = shape.subPath
    ? `

  it('${shape.subPath} is a ${shape.subRequired} when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const subParts = ${JSON.stringify(shape.subPath.split('.'))};
    let sub: unknown = cap;
    for (const p of subParts) {
      if (sub && typeof sub === 'object') sub = (sub as Record<string, unknown>)[p];
      else { sub = undefined; break; }
    }
    if (sub === undefined) return; // optional sub-field
    expect(
      typeof sub,
      driver.describe(
        'RFC ${def.rfc} §A',
        '${shape.path}.${shape.subPath} MUST be ${shape.subRequired} when present',
      ),
    ).toBe('${shape.subRequired}');
  });`
    : '';

  const behavioralBlock = def.behavioralTodos.map((t) => `  it.todo(${JSON.stringify(t)});`).join('\n');

  return `/**
 * ${title} — RFC ${def.rfc} advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC ${def.rfc} promoted to \`Active\`
 * 2026-05-17. The matching \`capabilities.${shape.path}\` block has landed in
 * \`schemas/capabilities.schema.json\`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as \`it.todo()\` until a reference host wires
 * a test seam.
 *
 * Summary: ${def.summary}${def.note ? '\n *\n * ' + def.note : ''}
 *
 * @see RFCS/${def.rfc}-*.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = ${accessor}
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('${title}: advertisement shape (RFC ${def.rfc})', () => {
  it('capabilities.${advName} is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §${shape.path}',
        'capabilities.${shape.path}.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });${subAssert}
});

describe('${title}: behavioral assertions (placeholders — need host test seam)', () => {
${behavioralBlock}
});
`;
}

// build the nested optional-chain accessor for the sub-field path
function pathSubAccessor(subPath) {
  return 'cap' + subPath.split('.').map((p) => `?.[${JSON.stringify(p)}]`).join('') + ' as unknown';
}

// regenerate (but skip fs-path-traversal which was hand-tuned).
let count = 0;
for (const [file, def] of Object.entries(SCENARIOS)) {
  if (file === 'fs-path-traversal.test.ts') continue;
  writeFileSync(join(OUT, file), fileBody(file, def));
  count++;
}
console.log(`promoted ${count} placeholder scenarios → advertisement-shape assertions`);
