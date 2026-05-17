#!/usr/bin/env node
/**
 * Emit it.todo() placeholder scenarios for the conformance tests
 * promised by RFCs 0014-0020. Mirrors the existing pattern from
 * conformance/src/scenarios/replay-llm-cache-key.test.ts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('conformance', 'src', 'scenarios');
mkdirSync(OUT, { recursive: true });

const SCENARIOS = [
  // RFC 0014: host.fs
  {
    file: 'fs-path-traversal.test.ts',
    rfc: '0014',
    spec: 'RFC 0014 §C `fs-path-traversal` invariant',
    capability: 'capabilities.fs.supported',
    title: 'fs-path-traversal',
    summary: 'host.fs MUST reject path traversal (`../`) and symlink-escape attempts.',
    todos: [
      'read("../etc/passwd") returns `path_outside_sandbox` (RFC 0014 §B)',
      'read(symlink-to-outside) returns `path_outside_sandbox` (RFC 0014 §B)',
      'write(huge-file) returns `file_too_large` when `maxFileSizeBytes` is advertised',
    ],
  },
  // RFC 0015: host.kvStorage
  {
    file: 'kv-cross-tenant-isolation.test.ts',
    rfc: '0015', spec: 'RFC 0015 §C `kv-cross-tenant-isolation` invariant',
    capability: 'capabilities.kvStorage.supported',
    title: 'kv-cross-tenant-isolation',
    summary: 'host.kvStorage MUST partition values by tenant. Cross-tenant reads MUST return not-found.',
    todos: [
      'set under tenant A → get under tenant B with same key returns `found:false`',
      'list under tenant B does not include keys set under tenant A',
    ],
  },
  {
    file: 'kv-atomic-increment.test.ts',
    rfc: '0015', spec: 'RFC 0015 §B point 4 (atomic increment)',
    capability: 'capabilities.kvStorage.atomicIncrement',
    title: 'kv-atomic-increment',
    summary: 'Atomic increment MUST be atomic across concurrent callers.',
    todos: [
      '1000 concurrent +1 increments → final value is 1000',
      'previous value reflects the count at the time of the increment',
    ],
  },
  {
    file: 'kv-cas.test.ts',
    rfc: '0015', spec: 'RFC 0015 §B point 5 (compare-and-swap)',
    capability: 'capabilities.kvStorage.compareAndSwap',
    title: 'kv-cas',
    summary: 'Compare-and-swap MUST be atomic — stale expect rejected.',
    todos: [
      'CAS with matching expect succeeds and updates value',
      'CAS with stale expect fails with `swapped:false` and returns actual',
    ],
  },
  {
    file: 'kv-ttl-expiry.test.ts',
    rfc: '0015', spec: 'RFC 0015 §B point 3 (TTL honored within 1s drift)',
    capability: 'capabilities.kvStorage.supported',
    title: 'kv-ttl-expiry',
    summary: 'TTL honored with at most a 1-second drift on expiry visibility.',
    todos: [
      'set with ttl=2 → get at t+1 returns the value; get at t+3 returns not-found',
      'TTL drift across the 1-second window is bounded',
    ],
  },
  // RFC 0016: host.tableStorage
  {
    file: 'table-cross-tenant-isolation.test.ts',
    rfc: '0016', spec: 'RFC 0016 §B point 1 (cross-tenant isolation)',
    capability: 'capabilities.tableStorage.supported',
    title: 'table-cross-tenant-isolation',
    summary: 'host.tableStorage MUST partition rows by tenant.',
    todos: [
      'insert under tenant A → query under tenant B returns 0 rows for the same table+filter',
    ],
  },
  {
    file: 'table-cursor-pagination.test.ts',
    rfc: '0016', spec: 'RFC 0016 §B point 3 (cursor pagination)',
    capability: 'capabilities.tableStorage.supported',
    title: 'table-cursor-pagination',
    summary: 'query MUST support filter + cursor pagination.',
    todos: [
      'first page returns N rows + nextCursor; second page resumes from nextCursor; final page returns nextCursor=null',
    ],
  },
  {
    file: 'table-schema-enforcement.test.ts',
    rfc: '0016', spec: 'RFC 0016 §B point 2 (schema declaration on first insert)',
    capability: 'capabilities.tableStorage.supported',
    title: 'table-schema-enforcement',
    summary: 'Subsequent rows MUST conform to the schema established on first insert.',
    todos: [
      'first insert declares schema; subsequent insert with wrong column type is rejected',
    ],
  },
  // RFC 0017: host.queueBus
  {
    file: 'queue-publish-consume-roundtrip.test.ts',
    rfc: '0017', spec: 'RFC 0017 §B (publish + consume roundtrip)',
    capability: 'capabilities.queueBus.supported',
    title: 'queue-publish-consume-roundtrip',
    summary: 'publish + consume + ack roundtrip with deduplicated delivery.',
    todos: [
      'publish → consume returns the message with the right payload + headers',
      'ack removes the message; subsequent consume blocks (or returns not-found within timeout)',
    ],
  },
  {
    file: 'queue-cross-tenant-isolation.test.ts',
    rfc: '0017', spec: 'RFC 0017 §C `queue-cross-tenant-isolation` invariant',
    capability: 'capabilities.queueBus.supported',
    title: 'queue-cross-tenant-isolation',
    summary: 'host.queueBus MUST partition messages by tenant.',
    todos: [
      'publish under tenant A on topic T → consume under tenant B on topic T returns not-found',
    ],
  },
  {
    file: 'queue-ack-nack-dlq.test.ts',
    rfc: '0017', spec: 'RFC 0017 §B point 2 (ack/nack/deadLetter semantics)',
    capability: 'capabilities.queueBus.deadLetterSupported',
    title: 'queue-ack-nack-dlq',
    summary: 'nack returns for redelivery; deadLetter routes to the configured DLQ.',
    todos: [
      'nack(requeue=true) → message is redelivered on next consume',
      'deadLetter → message appears on the configured DLQ',
    ],
  },
  {
    file: 'stream-subscribe-from-beginning.test.ts',
    rfc: '0017', spec: 'RFC 0017 §A `stream.fromBeginning`',
    capability: 'capabilities.queueBus.stream.fromBeginning',
    title: 'stream-subscribe-from-beginning',
    summary: 'Stream subscribers with fromBeginning=true receive records published before subscription.',
    todos: [
      'publish 5 records then subscribe(fromBeginning=true) → consumer receives all 5',
    ],
  },
  // RFC 0018: host.sql / vector / search
  {
    file: 'sql-injection-rejection.test.ts',
    rfc: '0018', spec: 'RFC 0018 §C `sql-parametric-only` invariant',
    capability: 'capabilities.sql.supported',
    title: 'sql-injection-rejection',
    summary: 'host.sql MUST reject non-parametric queries that inline user input.',
    todos: [
      "query({ sql: \"SELECT * FROM users WHERE id = '\" + userInput + \"'\", params: [] }) is rejected",
      "query({ sql: 'SELECT * FROM users WHERE id = ?', params: [userInput] }) succeeds",
    ],
  },
  {
    file: 'sql-transaction-atomicity.test.ts',
    rfc: '0018', spec: 'RFC 0018 §B point 3 (transaction atomicity)',
    capability: 'capabilities.sql.transactions',
    title: 'sql-transaction-atomicity',
    summary: 'transactions MUST be atomic; partial failure rolls back.',
    todos: [
      'transaction with N statements where N-th fails → no rows from earlier statements visible',
    ],
  },
  {
    file: 'vector-knn-roundtrip.test.ts',
    rfc: '0018', spec: 'RFC 0018 §D (vector roundtrip)',
    capability: 'capabilities.vectorStore.supported',
    title: 'vector-knn-roundtrip',
    summary: 'upsert then query returns the same vectors in top-k order.',
    todos: [
      'upsert 10 vectors → query with one of them returns it as top-1',
      'topK respects the configured limit',
    ],
  },
  {
    file: 'search-bm25-roundtrip.test.ts',
    rfc: '0018', spec: 'RFC 0018 §D (search roundtrip)',
    capability: 'capabilities.searchIndex.supported',
    title: 'search-bm25-roundtrip',
    summary: 'index then query returns relevant documents.',
    todos: [
      'index 3 docs → query returns relevance-ranked hits',
    ],
  },
  // RFC 0019: blob + cache
  {
    file: 'blob-roundtrip.test.ts',
    rfc: '0019', spec: 'RFC 0019 §C',
    capability: 'capabilities.blobStorage.supported',
    title: 'blob-roundtrip',
    summary: 'put then get returns the same content + size + etag.',
    todos: [
      'put binary content → get returns identical bytes',
      'get of non-existent key returns found:false',
    ],
  },
  {
    file: 'blob-presign-expiry.test.ts',
    rfc: '0019', spec: 'RFC 0019 §B point 1 (presigned URL expires at advertised TTL)',
    capability: 'capabilities.blobStorage.presignSupported',
    title: 'blob-presign-expiry',
    summary: 'Presigned URLs MUST expire at the advertised TTL.',
    todos: [
      'presign with ttl=60 → URL works during the window, returns 403 after',
    ],
  },
  {
    file: 'blob-cross-tenant-isolation.test.ts',
    rfc: '0019', spec: 'RFC 0019 §B point 1 (per-bucket tenant isolation)',
    capability: 'capabilities.blobStorage.supported',
    title: 'blob-cross-tenant-isolation',
    summary: 'host.blobStorage MUST isolate by tenant per bucket.',
    todos: [
      'put under tenant A → get under tenant B with same key returns found:false',
    ],
  },
  {
    file: 'cache-ttl-expiry.test.ts',
    rfc: '0019', spec: 'RFC 0019 §B point 2 (TTL drift ≤ 1s)',
    capability: 'capabilities.cache.supported',
    title: 'cache-ttl-expiry',
    summary: 'Cache TTL honored with at most 1-second drift.',
    todos: [
      'put with ttl=2 → hit within window; miss after',
    ],
  },
  {
    file: 'cache-cross-tenant-isolation.test.ts',
    rfc: '0019', spec: 'RFC 0019 §B point 2 (per-tenant scoping)',
    capability: 'capabilities.cache.supported',
    title: 'cache-cross-tenant-isolation',
    summary: 'Cache entries scoped per tenant.',
    todos: [
      'put under tenant A → get under tenant B returns miss',
    ],
  },
  // RFC 0020: MCP server-side
  {
    file: 'mcp-server-tool-roundtrip.test.ts',
    rfc: '0020', spec: 'RFC 0020 §A (tools/list + tools/call)',
    capability: 'capabilities.mcp.serverMount.supported',
    title: 'mcp-server-tool-roundtrip',
    summary: 'External MCP client discovers and invokes a workflow exposed via core.openwop.mcp.expose-tool.',
    todos: [
      'tools/list returns the exposed workflow',
      'tools/call with valid arguments completes the run and returns CallToolResult',
    ],
  },
  {
    file: 'mcp-server-resource-roundtrip.test.ts',
    rfc: '0020', spec: 'RFC 0020 §A (resources/list + resources/read)',
    capability: 'capabilities.mcp.serverMount.supported',
    title: 'mcp-server-resource-roundtrip',
    summary: 'External client lists + reads an exposed resource.',
    todos: [
      'resources/list returns the exposed resource',
      'resources/read returns the bound content',
    ],
  },
  {
    file: 'mcp-server-prompt-roundtrip.test.ts',
    rfc: '0020', spec: 'RFC 0020 §A (prompts/list + prompts/get)',
    capability: 'capabilities.mcp.serverMount.supported',
    title: 'mcp-server-prompt-roundtrip',
    summary: 'External client lists + retrieves an exposed prompt template.',
    todos: [
      'prompts/list returns the exposed prompt',
      'prompts/get with arguments returns the rendered messages',
    ],
  },
  {
    file: 'mcp-server-sampling-bridge.test.ts',
    rfc: '0020', spec: 'RFC 0020 §A point 3 (sampling/createMessage → ctx.callAI)',
    capability: 'capabilities.mcp.serverMount.samplingBridge',
    title: 'mcp-server-sampling-bridge',
    summary: 'Inbound sampling/createMessage routes through the workflow-chosen LLM (BYOK consent preserved).',
    todos: [
      'sampling/createMessage from external server is bridged to ctx.callAI and the result is returned',
    ],
  },
  {
    file: 'mcp-server-elicitation-bridge.test.ts',
    rfc: '0020', spec: 'RFC 0020 §A point 3 (elicitation/create → ctx.suspend)',
    capability: 'capabilities.mcp.serverMount.elicitationBridge',
    title: 'mcp-server-elicitation-bridge',
    summary: 'Inbound elicitation/create suspends the run on a typed form and resumes on accept/decline/cancel.',
    todos: [
      'elicitation/create with a flat schema suspends the run',
      'accept response resumes with payload; decline + cancel paths round-trip correctly',
    ],
  },
  {
    file: 'mcp-server-untrusted-args.test.ts',
    rfc: '0020', spec: 'RFC 0020 §D (untrusted boundary + inputSchema validation)',
    capability: 'capabilities.mcp.serverMount.supported',
    title: 'mcp-server-untrusted-args',
    summary: 'tools/call.arguments MUST validate against the declared inputSchema before workflow start.',
    todos: [
      'tools/call with arguments missing a required field is rejected with isError:true',
      'tools/call with arguments containing wrong types is rejected before the run starts',
    ],
  },
];

function fileBody(s) {
  return `/**
 * ${s.title} — placeholder scenario for ${s.spec}.
 *
 * Status: PLACEHOLDER. RFC ${s.rfc} is at \`Draft\` status as of 2026-05-17.
 * This scenario lands as \`it.todo()\` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC ${s.rfc} reaches \`Active\` status, AND
 *   2. The matching capability block lands in \`schemas/capabilities.schema.json\`, AND
 *   3. At least one reference host advertises \`${s.capability}\`.
 *
 * Summary: ${s.summary}
 *
 * @see RFCS/${s.rfc}-*.md
 */

import { describe, it } from 'vitest';

describe('${s.title}: placeholder for RFC ${s.rfc}', () => {
${s.todos.map((t) => `  it.todo(${JSON.stringify(t)});`).join('\n')}
});
`;
}

let count = 0;
for (const s of SCENARIOS) {
  writeFileSync(join(OUT, s.file), fileBody(s));
  count++;
}
console.log(`wrote ${count} placeholder scenarios to ${OUT}`);
