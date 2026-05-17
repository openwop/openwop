#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function emit(packName, manifest) {
  const ver = '1.0.0';
  const out = join('packs', packName, 'schemas');
  mkdirSync(out, { recursive: true });
  const $id = (f) => `https://packs.openwop.dev/${packName}/${ver}/${f}`;
  let count = 0;
  for (const [node, parts] of Object.entries(manifest)) {
    for (const [k, schema] of [['config', parts.c], ['input', parts.i], ['output', parts.o]]) {
      const f = `${node}.${k}.json`;
      const ordered = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: $id(f), ...schema };
      writeFileSync(join(out, f), JSON.stringify(ordered, null, 2) + '\n');
      count++;
    }
  }
  console.log(`wrote ${count} schemas to ${out}`);
}

const obj = (title, required, properties) => ({
  title, type: 'object',
  ...(required && required.length ? { required } : {}),
  properties, additionalProperties: false,
});

const ATTR = { type: 'object', additionalProperties: true };

const obs = {
  log: {
    c: obj('LogConfig', [], { level: { type: 'string', enum: ['debug','info','warn','error'], default: 'info' } }),
    i: obj('LogInput', ['message'], { message: { type: 'string' }, level: { type: 'string' }, attributes: ATTR }),
    o: obj('LogOutput', ['emitted'], { emitted: { type: 'boolean' }, level: { type: 'string' }, message: { type: 'string' } }),
  },
  'metric-counter': {
    c: obj('MetricCounterConfig', [], { name: { type: 'string' }, unit: { type: 'string' } }),
    i: obj('MetricCounterInput', [], { name: { type: 'string' }, value: { type: 'number', default: 1 }, attributes: ATTR }),
    o: obj('MetricCounterOutput', ['emitted'], { emitted: { type: 'boolean' }, kind: { type: 'string' }, name: { type: 'string' }, value: { type: 'number' } }),
  },
  'metric-gauge': {
    c: obj('MetricGaugeConfig', [], { name: { type: 'string' }, unit: { type: 'string' } }),
    i: obj('MetricGaugeInput', ['value'], { name: { type: 'string' }, value: { type: 'number' }, attributes: ATTR }),
    o: obj('MetricGaugeOutput', ['emitted'], { emitted: { type: 'boolean' }, kind: { type: 'string' }, name: { type: 'string' }, value: { type: 'number' } }),
  },
  'metric-histogram': {
    c: obj('MetricHistogramConfig', [], { name: { type: 'string' }, unit: { type: 'string' } }),
    i: obj('MetricHistogramInput', ['value'], { name: { type: 'string' }, value: { type: 'number' }, attributes: ATTR }),
    o: obj('MetricHistogramOutput', ['emitted'], { emitted: { type: 'boolean' }, kind: { type: 'string' }, name: { type: 'string' }, value: { type: 'number' } }),
  },
  'trace-span-start': {
    c: obj('TraceSpanStartConfig', [], { name: { type: 'string' } }),
    i: obj('TraceSpanStartInput', [], { name: { type: 'string' }, attributes: ATTR }),
    o: obj('TraceSpanStartOutput', ['spanHandle','name'], { spanHandle: {}, name: { type: 'string' } }),
  },
  'trace-span-end': {
    c: obj('TraceSpanEndConfig', [], {}),
    i: obj('TraceSpanEndInput', ['spanHandle'], { spanHandle: {}, status: { type: 'string', enum: ['ok','error'] }, attributes: ATTR }),
    o: obj('TraceSpanEndOutput', ['ended'], { ended: { type: 'boolean' } }),
  },
  'alert-fire': {
    c: obj('AlertFireConfig', [], { severity: { type: 'string', enum: ['info','warning','error','critical'], default: 'warning' } }),
    i: obj('AlertFireInput', ['title'], { title: { type: 'string' }, description: { type: 'string' }, severity: { type: 'string' }, attributes: ATTR, dedupKey: { type: 'string' } }),
    o: obj('AlertFireOutput', ['fired'], { fired: { type: 'boolean' }, event: { type: 'object', additionalProperties: true } }),
  },
};

const hitl = {
  'form-request': {
    c: obj('FormRequestConfig', ['formSchema'], {
      formSchema: { type: 'object', additionalProperties: true, description: 'Flat JSON Schema: object with primitive-typed properties (string/number/integer/boolean/enum, formats email/uri/date/date-time).' },
      deadlineSeconds: { type: 'integer', minimum: 0 },
    }),
    i: obj('FormRequestInput', ['prompt'], { prompt: { type: 'string' }, locale: { type: 'string' } }),
    o: obj('FormRequestOutput', ['action'], {
      action: { type: 'string', enum: ['accept','decline','cancel'] },
      payload: { type: 'object', additionalProperties: true },
      respondedBy: { type: ['string','null'] },
      respondedAt: { type: ['string','null'] },
    }),
  },
  'approval-request': {
    c: obj('ApprovalRequestConfig', [], {
      approvers: { type: 'array', items: { type: 'string' } },
      quorum: { type: 'integer', minimum: 1 },
      deadlineSeconds: { type: 'integer', minimum: 0 },
    }),
    i: obj('ApprovalRequestInput', ['prompt'], { prompt: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } }),
    o: obj('ApprovalRequestOutput', ['decision'], {
      decision: { type: 'string', enum: ['approve','reject'] },
      comment: { type: ['string','null'] },
      decidedBy: { type: ['string','null'] },
      decidedAt: { type: ['string','null'] },
    }),
  },
  'ask-user': {
    c: obj('AskUserConfig', [], { deadlineSeconds: { type: 'integer', minimum: 0 } }),
    i: obj('AskUserInput', ['prompt'], { prompt: { type: 'string' }, chatId: { type: 'string' } }),
    o: obj('AskUserOutput', ['answer'], {
      answer: { type: 'string' },
      answeredBy: { type: ['string','null'] },
      answeredAt: { type: ['string','null'] },
    }),
  },
};

emit('core.openwop.obs', obs);
emit('core.openwop.hitl', hitl);
