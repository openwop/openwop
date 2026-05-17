#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.a2a';
const VER = '1.0.0';
const OUT = join('packs', PACK, 'schemas');
mkdirSync(OUT, { recursive: true });
const $id = (f) => `https://packs.openwop.dev/${PACK}/${VER}/${f}`;
const obj = (title, required, properties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title, type: 'object',
  ...(required && required.length ? { required } : {}),
  properties, additionalProperties: false,
});

const PART = { type: 'object', additionalProperties: true, properties: {
  kind: { type: 'string', enum: ['text','file','data'] },
  text: { type: 'string' },
  data: {},
  file: { type: 'object', additionalProperties: true },
  mediaType: { type: 'string' },
  metadata: { type: 'object', additionalProperties: true },
} };

const MESSAGE = { type: 'object', additionalProperties: true, properties: {
  role: { type: 'string', enum: ['user','agent','system'] },
  parts: { type: 'array', items: PART },
  metadata: { type: 'object', additionalProperties: true },
} };

const TASK = { type: 'object', additionalProperties: true, properties: {
  id: { type: 'string' },
  contextId: { type: 'string' },
  status: { type: 'object', additionalProperties: true },
  history: { type: 'array' },
  artifacts: { type: 'array' },
} };

const URL_CONF = { type: 'string', format: 'uri' };

const M = {
  'discover-agent': {
    c: obj('DiscoverAgentConfig', ['baseUrl'], { baseUrl: URL_CONF, extended: { type: 'boolean', default: false } }),
    i: obj('DiscoverAgentInput', [], {}),
    o: obj('DiscoverAgentOutput', ['card'], { card: { type: 'object', additionalProperties: true } }),
  },
  'send-message': {
    c: obj('SendMessageConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('SendMessageInput', ['message'], { message: MESSAGE, taskId: { type: 'string' }, contextId: { type: 'string' } }),
    o: obj('SendMessageOutput', ['result'], { result: { type: 'object', additionalProperties: true } }),
  },
  'send-and-stream': {
    c: obj('SendAndStreamConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('SendAndStreamInput', ['message'], { message: MESSAGE, taskId: { type: 'string' }, contextId: { type: 'string' } }),
    o: obj('SendAndStreamOutput', ['terminal','events','eventCount'], {
      terminal: { type: 'object', additionalProperties: true },
      events: { type: 'array', items: { type: 'object', additionalProperties: true } },
      eventCount: { type: 'integer' },
    }),
  },
  'get-task': {
    c: obj('GetTaskConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('GetTaskInput', ['taskId'], { taskId: { type: 'string' } }),
    o: obj('GetTaskOutput', ['task'], { task: TASK }),
  },
  'list-tasks': {
    c: obj('ListTasksConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('ListTasksInput', [], { filter: { type: 'object', additionalProperties: true }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }),
    o: obj('ListTasksOutput', ['tasks'], { tasks: { type: 'array', items: TASK }, nextCursor: { type: ['string','null'] } }),
  },
  'cancel-task': {
    c: obj('CancelTaskConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('CancelTaskInput', ['taskId'], { taskId: { type: 'string' } }),
    o: obj('CancelTaskOutput', ['task'], { task: TASK }),
  },
  resubscribe: {
    c: obj('ResubscribeConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('ResubscribeInput', ['taskId'], { taskId: { type: 'string' } }),
    o: obj('ResubscribeOutput', ['terminal','events'], { terminal: TASK, events: { type: 'array' } }),
  },
  'multi-turn-coordinator': {
    c: obj('MultiTurnCoordinatorConfig', ['baseUrl'], { baseUrl: URL_CONF, maxTurns: { type: 'integer', minimum: 1, maximum: 100, default: 16 } }),
    i: obj('MultiTurnCoordinatorInput', ['task'], { task: TASK }),
    o: obj('MultiTurnCoordinatorOutput', ['task','terminal'], { task: TASK, terminal: { type: 'boolean' }, turns: { type: 'array' } }),
  },
  'push-config-create': {
    c: obj('PushConfigCreateConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('PushConfigCreateInput', ['taskId','pushNotificationConfig'], { taskId: { type: 'string' }, pushNotificationConfig: { type: 'object', additionalProperties: true } }),
    o: obj('PushConfigCreateOutput', ['result'], { result: { type: 'object', additionalProperties: true } }),
  },
  'push-config-get': {
    c: obj('PushConfigGetConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('PushConfigGetInput', ['taskId','configId'], { taskId: { type: 'string' }, configId: { type: 'string' } }),
    o: obj('PushConfigGetOutput', ['result'], { result: { type: 'object', additionalProperties: true } }),
  },
  'push-config-list': {
    c: obj('PushConfigListConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('PushConfigListInput', ['taskId'], { taskId: { type: 'string' } }),
    o: obj('PushConfigListOutput', ['result'], { result: { type: 'array', items: { type: 'object', additionalProperties: true } } }),
  },
  'push-config-delete': {
    c: obj('PushConfigDeleteConfig', ['baseUrl'], { baseUrl: URL_CONF }),
    i: obj('PushConfigDeleteInput', ['taskId','configId'], { taskId: { type: 'string' }, configId: { type: 'string' } }),
    o: obj('PushConfigDeleteOutput', ['result'], { result: { type: 'object', additionalProperties: true } }),
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
