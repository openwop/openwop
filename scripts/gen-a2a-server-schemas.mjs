#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.a2a';
const VER = '1.1.0';
const OUT = join('packs', PACK, 'schemas');
mkdirSync(OUT, { recursive: true });
const $id = (f) => `https://packs.openwop.dev/${PACK}/${VER}/${f}`;
const obj = (title, required, properties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title, type: 'object',
  ...(required && required.length ? { required } : {}),
  properties, additionalProperties: false,
});

const M = {
  'server-trigger': {
    c: obj('A2aServerTriggerConfig', [], { path: { type: 'string' }, transport: { type: 'string', enum: ['http','grpc'], default: 'http' } }),
    i: obj('A2aServerTriggerInput', [], {}),
    o: obj('A2aServerTriggerOutput', ['method'], {
      method: { type: 'string' }, message: {}, taskId: { type: ['string','null'] }, contextId: { type: ['string','null'] }, transport: { type: 'string' },
    }),
  },
  'agent-card-publish': {
    c: obj('AgentCardPublishConfig', [], { card: { type: 'object', additionalProperties: true }, signed: { type: 'boolean', default: false } }),
    i: obj('AgentCardPublishInput', [], { card: { type: 'object', additionalProperties: true } }),
    o: obj('AgentCardPublishOutput', ['published'], { card: { type: 'object', additionalProperties: true }, published: { type: 'boolean' } }),
  },
  'emit-status': {
    c: obj('A2aEmitStatusConfig', [], {}),
    i: obj('A2aEmitStatusInput', ['taskId','status'], {
      taskId: { type: 'string' }, status: { type: 'object', additionalProperties: true }, final: { type: 'boolean' },
    }),
    o: obj('A2aEmitStatusOutput', ['event'], { event: { type: 'object', additionalProperties: true } }),
  },
  'emit-artifact': {
    c: obj('A2aEmitArtifactConfig', [], {}),
    i: obj('A2aEmitArtifactInput', ['taskId','artifact'], {
      taskId: { type: 'string' }, artifact: { type: 'object', additionalProperties: true },
      append: { type: 'boolean' }, lastChunk: { type: 'boolean' },
    }),
    o: obj('A2aEmitArtifactOutput', ['event'], { event: { type: 'object', additionalProperties: true } }),
  },
  'push-send': {
    c: obj('A2aPushSendConfig', [], {}),
    i: obj('A2aPushSendInput', ['configId','event'], {
      configId: { type: 'string' }, event: { type: 'object', additionalProperties: true },
    }),
    o: obj('A2aPushSendOutput', ['receipt'], { receipt: { type: 'object', additionalProperties: true } }),
  },
};

let count = 0;
for (const [node, parts] of Object.entries(M)) {
  for (const [k, schema] of [['config', parts.c], ['input', parts.i], ['output', parts.o]]) {
    const f = `${node}.${k}.json`;
    const ordered = { $schema: schema.$schema, $id: $id(f), ...Object.fromEntries(Object.entries(schema).filter(([x]) => x !== '$schema' && x !== '$id')) };
    writeFileSync(join(OUT, f), JSON.stringify(ordered, null, 2) + '\n');
    count++;
  }
}
console.log(`wrote ${count} schemas to ${OUT}`);
