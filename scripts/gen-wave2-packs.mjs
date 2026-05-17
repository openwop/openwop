#!/usr/bin/env node
/**
 * Builds Wave 2 packs (storage, files, db, messaging):
 *  - emits per-node schemas (config/input/output) under packs/<pack>/schemas/
 *  - emits an index.mjs runtime per pack
 *  - patches pack.json with the generated `nodes[]` entries
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const obj = (title, required, properties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title, type: 'object',
  ...(required && required.length ? { required } : {}),
  properties, additionalProperties: false,
});
const STR = { type: 'string' };
const INT = { type: 'integer' };
const NUM = { type: 'number' };
const BOOL = { type: 'boolean' };
const ANY = {};
const META = { type: 'object', additionalProperties: true };

function emit(pack, manifest) {
  const ver = '1.0.0';
  const out = join('packs', pack, 'schemas');
  mkdirSync(out, { recursive: true });
  const $id = (f) => `https://packs.openwop.dev/${pack}/${ver}/${f}`;
  let schemaCount = 0;
  const entries = [];
  for (const [node, def] of Object.entries(manifest)) {
    for (const [k, schema] of [['config', def.c], ['input', def.i], ['output', def.o]]) {
      const f = `${node}.${k}.json`;
      const ordered = { $schema: schema.$schema, $id: $id(f), ...Object.fromEntries(Object.entries(schema).filter(([x]) => x !== '$schema' && x !== '$id')) };
      writeFileSync(join(out, f), JSON.stringify(ordered, null, 2) + '\n');
      schemaCount++;
    }
    entries.push({
      typeId: `core.${pack.split('.').pop()}.${node}`,
      version: '1.0.0',
      label: def.label,
      description: def.description,
      category: def.category || 'integration',
      role: def.role || 'side-effect',
      capabilities: def.capabilities || ['cacheable', 'side-effectful'],
      configSchemaRef: `schemas/${node}.config.json`,
      inputSchemaRef: `schemas/${node}.input.json`,
      outputSchemaRef: `schemas/${node}.output.json`,
    });
  }
  // Patch pack.json
  const path = join('packs', pack, 'pack.json');
  const j = JSON.parse(readFileSync(path, 'utf8'));
  j.nodes = entries;
  writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  return { pack, schemas: schemaCount, nodes: entries.length };
}

/* ─── manifests ──────────────────────────────────────────────── */

const storage = {
  'kv-get': {
    label: 'KV Get', description: 'Read a key from host.kvStorage. Returns { value, found, ttlRemainingMs }.',
    c: obj('KvGetConfig', [], { namespace: STR }),
    i: obj('KvGetInput', ['key'], { key: STR }),
    o: obj('KvGetOutput', ['found'], { value: ANY, found: BOOL, ttlRemainingMs: { type: ['integer','null'] } }),
  },
  'kv-set': {
    label: 'KV Set', description: 'Write a key/value. Optional TTL in seconds.',
    c: obj('KvSetConfig', [], { namespace: STR, ttlSeconds: INT }),
    i: obj('KvSetInput', ['key','value'], { key: STR, value: ANY }),
    o: obj('KvSetOutput', [], { ok: BOOL, replaced: BOOL }),
  },
  'kv-delete': {
    label: 'KV Delete', description: 'Delete a key. Idempotent.',
    c: obj('KvDeleteConfig', [], { namespace: STR }),
    i: obj('KvDeleteInput', ['key'], { key: STR }),
    o: obj('KvDeleteOutput', [], { deleted: BOOL }),
  },
  'kv-list': {
    label: 'KV List', description: 'List keys in a namespace, with optional prefix + cursor.',
    c: obj('KvListConfig', [], { namespace: STR, limit: INT, prefix: STR }),
    i: obj('KvListInput', [], { cursor: STR }),
    o: obj('KvListOutput', ['keys'], { keys: { type: 'array', items: STR }, nextCursor: { type: ['string','null'] } }),
  },
  'kv-atomic-increment': {
    label: 'KV Atomic Increment', description: 'Atomic counter increment (RFC 0015). Returns the new value.',
    c: obj('KvAtomicIncrementConfig', [], { namespace: STR, delta: { type: 'integer', default: 1 } }),
    i: obj('KvAtomicIncrementInput', ['key'], { key: STR }),
    o: obj('KvAtomicIncrementOutput', ['value'], { value: INT, previous: INT }),
  },
  'kv-cas': {
    label: 'KV Compare-And-Swap', description: 'Optimistic concurrency primitive (RFC 0015).',
    c: obj('KvCasConfig', [], { namespace: STR }),
    i: obj('KvCasInput', ['key','expect','set'], { key: STR, expect: ANY, set: ANY }),
    o: obj('KvCasOutput', ['swapped'], { swapped: BOOL, actual: ANY }),
  },
  'table-insert': {
    label: 'Table Insert', description: 'Insert a row into a host.tableStorage table.',
    c: obj('TableInsertConfig', ['table'], { table: STR }),
    i: obj('TableInsertInput', ['row'], { row: META }),
    o: obj('TableInsertOutput', ['id'], { id: STR }),
  },
  'table-update': {
    label: 'Table Update', description: 'Update rows matching a filter.',
    c: obj('TableUpdateConfig', ['table'], { table: STR }),
    i: obj('TableUpdateInput', ['filter','update'], { filter: META, update: META }),
    o: obj('TableUpdateOutput', ['updated'], { updated: INT }),
  },
  'table-upsert': {
    label: 'Table Upsert', description: 'Insert if absent, update if present.',
    c: obj('TableUpsertConfig', ['table','keyColumns'], { table: STR, keyColumns: { type: 'array', items: STR } }),
    i: obj('TableUpsertInput', ['row'], { row: META }),
    o: obj('TableUpsertOutput', [], { id: STR, inserted: BOOL, updated: BOOL }),
  },
  'table-delete': {
    label: 'Table Delete', description: 'Delete rows matching a filter.',
    c: obj('TableDeleteConfig', ['table'], { table: STR }),
    i: obj('TableDeleteInput', ['filter'], { filter: META }),
    o: obj('TableDeleteOutput', ['deleted'], { deleted: INT }),
  },
  'table-query': {
    label: 'Table Query', description: 'Cursor-paginated query.',
    c: obj('TableQueryConfig', ['table'], { table: STR, limit: INT, orderBy: { type: 'array', items: STR } }),
    i: obj('TableQueryInput', [], { filter: META, cursor: STR }),
    o: obj('TableQueryOutput', ['rows'], { rows: { type: 'array', items: META }, nextCursor: { type: ['string','null'] } }),
  },
  'table-count': {
    label: 'Table Count', description: 'Count rows matching a filter.',
    c: obj('TableCountConfig', ['table'], { table: STR }),
    i: obj('TableCountInput', [], { filter: META }),
    o: obj('TableCountOutput', ['count'], { count: INT }),
  },
  'cache-get': {
    label: 'Cache Get', description: 'TTL cache read (host.cache).',
    c: obj('CacheGetConfig', [], { namespace: STR }),
    i: obj('CacheGetInput', ['key'], { key: STR }),
    o: obj('CacheGetOutput', ['hit'], { hit: BOOL, value: ANY, ageMs: INT }),
  },
  'cache-put': {
    label: 'Cache Put', description: 'TTL cache write.',
    c: obj('CachePutConfig', [], { namespace: STR, ttlSeconds: INT }),
    i: obj('CachePutInput', ['key','value'], { key: STR, value: ANY }),
    o: obj('CachePutOutput', [], { ok: BOOL }),
  },
  'cache-evict': {
    label: 'Cache Evict', description: 'Cache eviction by key or namespace.',
    c: obj('CacheEvictConfig', [], { namespace: STR }),
    i: obj('CacheEvictInput', [], { key: STR }),
    o: obj('CacheEvictOutput', ['evicted'], { evicted: INT }),
  },
  'blob-put': {
    label: 'Blob Put', description: 'Upload binary content to host.blobStorage.',
    c: obj('BlobPutConfig', [], { bucket: STR, contentType: STR }),
    i: obj('BlobPutInput', ['key','contentBase64'], { key: STR, contentBase64: STR }),
    o: obj('BlobPutOutput', ['key'], { key: STR, size: INT, etag: STR }),
  },
  'blob-get': {
    label: 'Blob Get', description: 'Download a blob (returns base64).',
    c: obj('BlobGetConfig', [], { bucket: STR }),
    i: obj('BlobGetInput', ['key'], { key: STR }),
    o: obj('BlobGetOutput', ['found'], { found: BOOL, contentBase64: STR, contentType: STR, size: INT }),
  },
  'blob-presign': {
    label: 'Blob Presign URL', description: 'Generate a time-limited presigned URL.',
    c: obj('BlobPresignConfig', [], { bucket: STR, operation: { type: 'string', enum: ['get','put'], default: 'get' }, ttlSeconds: { type: 'integer', default: 900 } }),
    i: obj('BlobPresignInput', ['key'], { key: STR }),
    o: obj('BlobPresignOutput', ['url'], { url: STR, expiresAt: STR }),
  },
  'queue-enqueue': {
    label: 'Queue Enqueue', description: 'Enqueue a job onto host.queue.',
    c: obj('QueueEnqueueConfig', ['queue'], { queue: STR, delaySeconds: INT }),
    i: obj('QueueEnqueueInput', ['payload'], { payload: ANY }),
    o: obj('QueueEnqueueOutput', ['jobId'], { jobId: STR }),
  },
  'queue-dequeue': {
    label: 'Queue Dequeue', description: 'Dequeue one job (blocking up to durationMs).',
    c: obj('QueueDequeueConfig', ['queue'], { queue: STR, durationMs: { type: 'integer', default: 30000 } }),
    i: obj('QueueDequeueInput', [], {}),
    o: obj('QueueDequeueOutput', ['found'], { found: BOOL, jobId: STR, payload: ANY }),
  },
};

const files = {
  read: {
    label: 'File Read', description: 'Read a file from host.fs (returns base64). Host enforces sandbox + path traversal.',
    c: obj('FileReadConfig', [], { encoding: { type: 'string', enum: ['base64','utf8'], default: 'base64' } }),
    i: obj('FileReadInput', ['path'], { path: STR }),
    o: obj('FileReadOutput', ['content'], { content: STR, size: INT, contentType: STR }),
  },
  write: {
    label: 'File Write', description: 'Write a file. Optional create-only mode.',
    c: obj('FileWriteConfig', [], { encoding: { type: 'string', enum: ['base64','utf8'], default: 'base64' }, mode: { type: 'string', enum: ['overwrite','create-only','append'], default: 'overwrite' } }),
    i: obj('FileWriteInput', ['path','content'], { path: STR, content: STR }),
    o: obj('FileWriteOutput', [], { bytes: INT }),
  },
  delete: {
    label: 'File Delete', description: 'Delete a file. Idempotent.',
    c: obj('FileDeleteConfig', [], {}),
    i: obj('FileDeleteInput', ['path'], { path: STR }),
    o: obj('FileDeleteOutput', ['deleted'], { deleted: BOOL }),
  },
  stat: {
    label: 'File Stat', description: 'fstat — returns size, mtime, isDirectory.',
    c: obj('FileStatConfig', [], {}),
    i: obj('FileStatInput', ['path'], { path: STR }),
    o: obj('FileStatOutput', ['exists'], { exists: BOOL, size: INT, mtime: STR, isDirectory: BOOL }),
  },
  list: {
    label: 'File List', description: 'List a directory.',
    c: obj('FileListConfig', [], { recursive: BOOL, includeHidden: BOOL }),
    i: obj('FileListInput', ['path'], { path: STR }),
    o: obj('FileListOutput', ['entries'], { entries: { type: 'array', items: META } }),
  },
  'to-base64': {
    label: 'To Base64', description: 'Pure utility: utf8 → base64.',
    c: obj('ToBase64Config', [], {}),
    i: obj('ToBase64Input', ['text'], { text: STR }),
    o: obj('ToBase64Output', ['base64'], { base64: STR }),
  },
  'from-base64': {
    label: 'From Base64', description: 'Pure utility: base64 → utf8 (or hex).',
    c: obj('FromBase64Config', [], { outputEncoding: { type: 'string', enum: ['utf8','hex'], default: 'utf8' } }),
    i: obj('FromBase64Input', ['base64'], { base64: STR }),
    o: obj('FromBase64Output', ['text'], { text: STR }),
  },
  'detect-mime': {
    label: 'Detect MIME', description: 'Sniff content type from first bytes + filename hint.',
    c: obj('DetectMimeConfig', [], {}),
    i: obj('DetectMimeInput', [], { filename: STR, contentBase64: STR }),
    o: obj('DetectMimeOutput', ['mimeType'], { mimeType: STR, confidence: NUM }),
  },
  'image-resize': {
    label: 'Image Resize', description: 'Resize an image. Delegates to ctx.image.',
    c: obj('ImageResizeConfig', [], { width: INT, height: INT, fit: { type: 'string', enum: ['contain','cover','fill','inside','outside'], default: 'inside' } }),
    i: obj('ImageResizeInput', ['contentBase64'], { contentBase64: STR, contentType: STR }),
    o: obj('ImageResizeOutput', ['contentBase64'], { contentBase64: STR, width: INT, height: INT, contentType: STR }),
  },
  'image-crop': {
    label: 'Image Crop', description: 'Crop an image by bbox.',
    c: obj('ImageCropConfig', ['x','y','width','height'], { x: INT, y: INT, width: INT, height: INT }),
    i: obj('ImageCropInput', ['contentBase64'], { contentBase64: STR, contentType: STR }),
    o: obj('ImageCropOutput', ['contentBase64'], { contentBase64: STR, contentType: STR }),
  },
  'image-format-convert': {
    label: 'Image Format Convert', description: 'Convert between JPEG / PNG / WebP / AVIF.',
    c: obj('ImageFormatConvertConfig', ['to'], { to: { type: 'string', enum: ['jpeg','png','webp','avif'] }, quality: INT }),
    i: obj('ImageFormatConvertInput', ['contentBase64'], { contentBase64: STR, contentType: STR }),
    o: obj('ImageFormatConvertOutput', ['contentBase64','contentType'], { contentBase64: STR, contentType: STR }),
  },
  'pdf-extract-text': {
    label: 'PDF Extract Text', description: 'Extract text from a PDF.',
    c: obj('PdfExtractTextConfig', [], {}),
    i: obj('PdfExtractTextInput', ['contentBase64'], { contentBase64: STR }),
    o: obj('PdfExtractTextOutput', ['text'], { text: STR, pages: INT }),
  },
  'pdf-split': {
    label: 'PDF Split', description: 'Split a PDF by page ranges.',
    c: obj('PdfSplitConfig', ['ranges'], { ranges: { type: 'array', items: STR } }),
    i: obj('PdfSplitInput', ['contentBase64'], { contentBase64: STR }),
    o: obj('PdfSplitOutput', ['parts'], { parts: { type: 'array', items: META } }),
  },
  'pdf-merge': {
    label: 'PDF Merge', description: 'Merge N PDFs.',
    c: obj('PdfMergeConfig', [], {}),
    i: obj('PdfMergeInput', ['parts'], { parts: { type: 'array', items: STR } }),
    o: obj('PdfMergeOutput', ['contentBase64'], { contentBase64: STR, pages: INT }),
  },
  'archive-create': {
    label: 'Archive Create', description: 'Create a zip / tar / gz archive.',
    c: obj('ArchiveCreateConfig', ['format'], { format: { type: 'string', enum: ['zip','tar','tar-gz'] } }),
    i: obj('ArchiveCreateInput', ['entries'], { entries: { type: 'array', items: obj('Entry', ['path','contentBase64'], { path: STR, contentBase64: STR }) } }),
    o: obj('ArchiveCreateOutput', ['contentBase64'], { contentBase64: STR, size: INT }),
  },
  'archive-extract': {
    label: 'Archive Extract', description: 'Extract a zip / tar / gz archive.',
    c: obj('ArchiveExtractConfig', ['format'], { format: { type: 'string', enum: ['zip','tar','tar-gz'] } }),
    i: obj('ArchiveExtractInput', ['contentBase64'], { contentBase64: STR }),
    o: obj('ArchiveExtractOutput', ['entries'], { entries: { type: 'array' } }),
  },
  ftp: {
    label: 'FTP Get / Put', description: 'FTP file transfer. Delegates to ctx.ftp.',
    c: obj('FtpConfig', ['host','operation'], { host: STR, port: INT, operation: { type: 'string', enum: ['get','put','list','delete'] } }),
    i: obj('FtpInput', ['path'], { path: STR, contentBase64: STR }),
    o: obj('FtpOutput', [], { contentBase64: STR, entries: { type: 'array' }, ok: BOOL }),
  },
  sftp: {
    label: 'SFTP Get / Put', description: 'SFTP file transfer. Delegates to ctx.sftp.',
    c: obj('SftpConfig', ['host','operation'], { host: STR, port: INT, operation: { type: 'string', enum: ['get','put','list','delete'] } }),
    i: obj('SftpInput', ['path'], { path: STR, contentBase64: STR }),
    o: obj('SftpOutput', [], { contentBase64: STR, entries: { type: 'array' }, ok: BOOL }),
  },
  'ssh-run': {
    label: 'SSH Run', description: 'Execute a command on a remote host via SSH.',
    c: obj('SshRunConfig', ['host'], { host: STR, port: INT, user: STR, timeoutMs: INT }),
    i: obj('SshRunInput', ['command'], { command: STR }),
    o: obj('SshRunOutput', ['exitCode'], { exitCode: INT, stdout: STR, stderr: STR }),
  },
};

const db = {
  'sql-query': {
    label: 'SQL Query', description: 'Parametric SQL SELECT. Host MUST reject non-parametric queries (RFC 0018).',
    c: obj('SqlQueryConfig', ['datasource'], { datasource: STR }),
    i: obj('SqlQueryInput', ['sql'], { sql: STR, params: { type: 'array', items: ANY } }),
    o: obj('SqlQueryOutput', ['rows'], { rows: { type: 'array', items: META }, rowCount: INT }),
  },
  'sql-execute': {
    label: 'SQL Execute', description: 'Parametric INSERT / UPDATE / DELETE.',
    c: obj('SqlExecuteConfig', ['datasource'], { datasource: STR }),
    i: obj('SqlExecuteInput', ['sql'], { sql: STR, params: { type: 'array', items: ANY } }),
    o: obj('SqlExecuteOutput', ['affected'], { affected: INT, insertId: { type: ['string','integer','null'] } }),
  },
  'sql-transaction': {
    label: 'SQL Transaction', description: 'Atomic transaction across N statements.',
    c: obj('SqlTransactionConfig', ['datasource'], { datasource: STR }),
    i: obj('SqlTransactionInput', ['statements'], { statements: { type: 'array', items: obj('Stmt', ['sql'], { sql: STR, params: { type: 'array' } }) } }),
    o: obj('SqlTransactionOutput', ['committed'], { committed: BOOL, results: { type: 'array' } }),
  },
  'nosql-find': {
    label: 'NoSQL Find', description: 'MongoDB-shape find.',
    c: obj('NosqlFindConfig', ['datasource','collection'], { datasource: STR, collection: STR, limit: INT }),
    i: obj('NosqlFindInput', [], { filter: META, projection: META, sort: META }),
    o: obj('NosqlFindOutput', ['docs'], { docs: { type: 'array', items: META } }),
  },
  'nosql-insert': {
    label: 'NoSQL Insert', description: 'MongoDB-shape insertOne / insertMany.',
    c: obj('NosqlInsertConfig', ['datasource','collection'], { datasource: STR, collection: STR }),
    i: obj('NosqlInsertInput', ['docs'], { docs: { type: 'array', items: META } }),
    o: obj('NosqlInsertOutput', ['inserted'], { inserted: INT, ids: { type: 'array' } }),
  },
  'nosql-update': {
    label: 'NoSQL Update', description: 'updateMany.',
    c: obj('NosqlUpdateConfig', ['datasource','collection'], { datasource: STR, collection: STR, upsert: BOOL }),
    i: obj('NosqlUpdateInput', ['filter','update'], { filter: META, update: META }),
    o: obj('NosqlUpdateOutput', ['matched'], { matched: INT, modified: INT }),
  },
  'nosql-delete': {
    label: 'NoSQL Delete', description: 'deleteMany.',
    c: obj('NosqlDeleteConfig', ['datasource','collection'], { datasource: STR, collection: STR }),
    i: obj('NosqlDeleteInput', ['filter'], { filter: META }),
    o: obj('NosqlDeleteOutput', ['deleted'], { deleted: INT }),
  },
  'search-index': {
    label: 'Search Index', description: 'Index a document into a search store.',
    c: obj('SearchIndexConfig', ['index'], { index: STR }),
    i: obj('SearchIndexInput', ['id','document'], { id: STR, document: META }),
    o: obj('SearchIndexOutput', [], { indexed: BOOL, version: INT }),
  },
  'search-query': {
    label: 'Search Query', description: 'Full-text query against a search index.',
    c: obj('SearchQueryConfig', ['index'], { index: STR, limit: INT }),
    i: obj('SearchQueryInput', ['query'], { query: STR, filter: META }),
    o: obj('SearchQueryOutput', ['hits'], { hits: { type: 'array' }, totalHits: INT }),
  },
  'vector-upsert': {
    label: 'Vector Upsert', description: 'Insert / update embedding vectors.',
    c: obj('VectorUpsertConfig', ['collection'], { collection: STR }),
    i: obj('VectorUpsertInput', ['records'], { records: { type: 'array', items: obj('VRec', ['id','vector'], {
      id: STR, vector: { type: 'array', items: NUM }, metadata: META,
    }) } }),
    o: obj('VectorUpsertOutput', ['upserted'], { upserted: INT }),
  },
  'vector-query': {
    label: 'Vector Query', description: 'k-NN search.',
    c: obj('VectorQueryConfig', ['collection'], { collection: STR, topK: { type: 'integer', default: 10 } }),
    i: obj('VectorQueryInput', ['vector'], { vector: { type: 'array', items: NUM }, filter: META }),
    o: obj('VectorQueryOutput', ['hits'], { hits: { type: 'array' } }),
  },
  'vector-delete': {
    label: 'Vector Delete', description: 'Delete vectors by id or filter.',
    c: obj('VectorDeleteConfig', ['collection'], { collection: STR }),
    i: obj('VectorDeleteInput', [], { ids: { type: 'array', items: STR }, filter: META }),
    o: obj('VectorDeleteOutput', ['deleted'], { deleted: INT }),
  },
};

const messaging = {
  publish: {
    label: 'MQ Publish', description: 'Publish a message to a topic / queue.',
    c: obj('MqPublishConfig', ['topic'], { topic: STR, partitionKey: STR }),
    i: obj('MqPublishInput', ['payload'], { payload: ANY, headers: META }),
    o: obj('MqPublishOutput', [], { messageId: STR, partition: STR }),
  },
  consume: {
    label: 'MQ Consume Trigger', description: 'Inbound subscription. ctx.triggerData carries the message.',
    c: obj('MqConsumeConfig', ['topic'], { topic: STR, consumerGroup: STR }),
    i: obj('MqConsumeInput', [], {}),
    o: obj('MqConsumeOutput', ['payload'], { payload: ANY, headers: META, messageId: STR, partition: STR }),
  },
  ack: {
    label: 'MQ Ack', description: 'Acknowledge message delivery.',
    c: obj('MqAckConfig', [], {}),
    i: obj('MqAckInput', ['messageId'], { messageId: STR }),
    o: obj('MqAckOutput', [], { acked: BOOL }),
  },
  nack: {
    label: 'MQ Nack', description: 'Negatively acknowledge — request redelivery.',
    c: obj('MqNackConfig', [], { requeue: { type: 'boolean', default: true } }),
    i: obj('MqNackInput', ['messageId'], { messageId: STR }),
    o: obj('MqNackOutput', [], { nacked: BOOL }),
  },
  'dead-letter': {
    label: 'MQ Dead Letter', description: 'Move a message to the configured dead-letter queue.',
    c: obj('MqDeadLetterConfig', [], {}),
    i: obj('MqDeadLetterInput', ['messageId'], { messageId: STR, reason: STR }),
    o: obj('MqDeadLetterOutput', [], { routed: BOOL }),
  },
  'stream-subscribe': {
    label: 'Stream Subscribe Trigger', description: 'Subscribe to a stream (Kafka / Kinesis / Redis-Streams).',
    c: obj('StreamSubscribeConfig', ['stream'], { stream: STR, consumerGroup: STR, fromBeginning: BOOL }),
    i: obj('StreamSubscribeInput', [], {}),
    o: obj('StreamSubscribeOutput', ['record'], { record: META, offset: STR, partition: STR }),
  },
  'stream-publish': {
    label: 'Stream Publish', description: 'Publish a record to a stream.',
    c: obj('StreamPublishConfig', ['stream'], { stream: STR }),
    i: obj('StreamPublishInput', ['record'], { record: META, partitionKey: STR }),
    o: obj('StreamPublishOutput', [], { offset: STR, partition: STR }),
  },
};

const results = [
  emit('core.openwop.storage', storage),
  emit('core.openwop.files', files),
  emit('core.openwop.db', db),
  emit('core.openwop.messaging', messaging),
];
for (const r of results) console.log(`${r.pack}: ${r.nodes} nodes, ${r.schemas} schemas`);
