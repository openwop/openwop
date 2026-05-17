#!/usr/bin/env node
/**
 * Generate the 75 schema files (config/input/output × 25 nodes) for
 * core.openwop.flow. Run from repo root:
 *   node scripts/gen-flow-pack-schemas.mjs
 *
 * Idempotent: rewrites every file. Driven by a single MANIFEST table
 * so the JSON is consistent across nodes.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.flow';
const VER = '1.0.0';
const OUT_DIR = join('packs', PACK, 'schemas');
mkdirSync(OUT_DIR, { recursive: true });

const $id = (file) => `https://packs.openwop.dev/${PACK}/${VER}/${file}`;

const PREDICATE_SCHEMA = {
  type: 'object',
  required: ['path', 'op'],
  properties: {
    path: { type: 'string', description: 'Dot-notation path into the input value.' },
    op: {
      type: 'string',
      enum: ['eq','neq','lt','lte','gt','gte','in','contains','starts-with','ends-with','regex','exists','not-exists','truthy','falsy'],
    },
    value: { description: 'Comparison target. Omitted for `exists`/`not-exists`/`truthy`/`falsy`.' },
  },
  additionalProperties: false,
};

const obj = (title, required, properties, extra = {}) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title,
  type: 'object',
  ...(required && required.length ? { required } : {}),
  properties,
  additionalProperties: false,
  ...extra,
});

const MANIFEST = {
  if: {
    config: obj('IfConfig', ['predicate'], { predicate: PREDICATE_SCHEMA }),
    input: obj('IfInput', ['value'], { value: {} }),
    output: obj('IfOutput', ['branch','matched','value'], {
      branch: { type: 'string', enum: ['then','else'] },
      matched: { type: 'boolean' },
      value: {},
    }),
  },
  switch: {
    config: obj('SwitchConfig', ['cases'], {
      cases: { type: 'object', additionalProperties: { type: 'string' }, description: 'Map of case key → output label.' },
      default: { type: 'string', description: 'Label when no case matches.' },
    }),
    input: obj('SwitchInput', ['value'], { value: {} }),
    output: obj('SwitchOutput', ['label','matched','value'], {
      label: { type: ['string','null'] },
      matched: { type: 'boolean' },
      value: {},
    }),
  },
  router: {
    config: obj('RouterConfig', ['routes'], {
      routes: {
        type: 'array',
        minItems: 1,
        items: obj('Route', ['label'], {
          label: { type: 'string' },
          predicate: PREDICATE_SCHEMA,
        }),
      },
      mode: { type: 'string', enum: ['first-match','all-match'], default: 'first-match' },
      defaultLabel: { type: 'string', description: 'Label emitted when no route matched.' },
    }),
    input: obj('RouterInput', ['value'], { value: {} }),
    output: obj('RouterOutput', ['branches','value'], {
      branches: { type: 'array', items: { type: 'string' } },
      value: {},
    }),
  },
  filter: {
    config: obj('FilterConfig', ['predicate'], { predicate: PREDICATE_SCHEMA }),
    input: obj('FilterInput', ['value'], { value: {} }),
    output: obj('FilterOutput', ['passed'], {
      passed: { type: 'boolean' },
      value: {},
    }),
  },
  merge: {
    config: obj('MergeConfig', ['mode'], {
      mode: { type: 'string', enum: ['append','combine-by-key','combine-by-position','multiplex','choose-branch'] },
      keyPath: { type: 'string', description: 'Required when mode is `combine-by-key`.' },
    }),
    input: obj('MergeInput', ['inputs'], {
      inputs: { type: 'array', items: { type: 'array' }, description: 'Array of input arrays to merge.' },
    }),
    output: obj('MergeOutput', ['merged'], { merged: { type: 'array' } }),
  },
  iterator: {
    config: obj('IteratorConfig', [], {}),
    input: obj('IteratorInput', ['array'], { array: { type: 'array' } }),
    output: obj('IteratorOutput', ['items','total'], {
      items: { type: 'array', items: obj('Bundle', ['item','index','total'], {
        item: {}, index: { type: 'integer' }, total: { type: 'integer' },
      }) },
      total: { type: 'integer' },
    }),
  },
  'aggregate-array': {
    config: obj('AggregateArrayConfig', [], {}),
    input: obj('AggregateArrayInput', ['items'], { items: { type: 'array' } }),
    output: obj('AggregateArrayOutput', ['array'], { array: { type: 'array' } }),
  },
  'aggregate-numeric': {
    config: obj('AggregateNumericConfig', ['op','path'], {
      op: { type: 'string', enum: ['sum','count','avg','min','max'] },
      path: { type: 'string' },
    }),
    input: obj('AggregateNumericInput', ['items'], { items: { type: 'array' } }),
    output: obj('AggregateNumericOutput', ['result','count'], {
      result: { type: ['number','null'] },
      count: { type: 'integer' },
    }),
  },
  'aggregate-text': {
    config: obj('AggregateTextConfig', [], {
      path: { type: 'string', description: 'Optional path to value when template is absent.' },
      template: { type: 'string', description: 'Mustache-style template applied per item.' },
      separator: { type: 'string', default: '' },
    }),
    input: obj('AggregateTextInput', ['items'], { items: { type: 'array' } }),
    output: obj('AggregateTextOutput', ['text','count'], {
      text: { type: 'string' }, count: { type: 'integer' },
    }),
  },
  'aggregate-table': {
    config: obj('AggregateTableConfig', ['columns'], {
      columns: {
        type: 'array', minItems: 1,
        items: obj('Column', ['path'], { path: { type: 'string' }, label: { type: 'string' } }),
      },
    }),
    input: obj('AggregateTableInput', ['items'], { items: { type: 'array' } }),
    output: obj('AggregateTableOutput', ['columns','rows','rowCount'], {
      columns: { type: 'array', items: { type: 'string' } },
      rows: { type: 'array', items: { type: 'array' } },
      rowCount: { type: 'integer' },
    }),
  },
  'split-in-batches': {
    config: obj('SplitInBatchesConfig', ['batchSize'], {
      batchSize: { type: 'integer', minimum: 1 },
    }),
    input: obj('SplitInBatchesInput', ['array'], { array: { type: 'array' } }),
    output: obj('SplitInBatchesOutput', ['batch','remaining','done','batchSize','remainingCount'], {
      batch: { type: 'array' },
      remaining: { type: 'array' },
      done: { type: 'boolean' },
      batchSize: { type: 'integer' },
      remainingCount: { type: 'integer' },
    }),
  },
  sort: {
    config: obj('SortConfig', ['keys'], {
      keys: {
        type: 'array', minItems: 1,
        items: obj('SortKey', ['path'], {
          path: { type: 'string' },
          direction: { type: 'string', enum: ['asc','desc'], default: 'asc' },
          compare: { type: 'string', enum: ['default','natural'], default: 'default' },
        }),
      },
    }),
    input: obj('SortInput', ['array'], { array: { type: 'array' } }),
    output: obj('SortOutput', ['array'], { array: { type: 'array' } }),
  },
  limit: {
    config: obj('LimitConfig', ['count'], {
      count: { type: 'integer', minimum: 0 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    }),
    input: obj('LimitInput', ['array'], { array: { type: 'array' } }),
    output: obj('LimitOutput', ['array','count'], { array: { type: 'array' }, count: { type: 'integer' } }),
  },
  distinct: {
    config: obj('DistinctConfig', [], {
      path: { type: 'string', description: 'Optional key path for the dedupe key; full-item canonical when absent.' },
    }),
    input: obj('DistinctInput', ['array'], { array: { type: 'array' } }),
    output: obj('DistinctOutput', ['array','dropped'], {
      array: { type: 'array' }, dropped: { type: 'integer' },
    }),
  },
  'compare-datasets': {
    config: obj('CompareDatasetsConfig', ['keyPath'], { keyPath: { type: 'string' } }),
    input: obj('CompareDatasetsInput', ['left','right'], { left: { type: 'array' }, right: { type: 'array' } }),
    output: obj('CompareDatasetsOutput', ['addedIn2','removedFrom1','changed','unchanged'], {
      addedIn2: { type: 'array' },
      removedFrom1: { type: 'array' },
      changed: { type: 'array', items: obj('Diff', ['before','after'], { before: {}, after: {} }) },
      unchanged: { type: 'array' },
    }),
  },
  repeater: {
    config: obj('RepeaterConfig', ['count'], {
      count: { type: 'integer', minimum: 0 },
      start: { type: 'number', default: 0 },
      step: { type: 'number', default: 1 },
    }),
    input: obj('RepeaterInput', [], {}),
    output: obj('RepeaterOutput', ['items','count'], {
      items: { type: 'array', items: obj('Tick', ['i','index','total'], {
        i: { type: 'number' }, index: { type: 'integer' }, total: { type: 'integer' },
      }) },
      count: { type: 'integer' },
    }),
  },
  noop: {
    config: obj('NoopConfig', [], {}),
    input: obj('NoopInput', [], { value: {} }),
    output: obj('NoopOutput', [], { value: {} }),
  },
  'stop-and-error': {
    config: obj('StopAndErrorConfig', [], {
      code: { type: 'string', default: 'WORKFLOW_STOPPED' },
      message: { type: 'string' },
      details: { type: 'object', additionalProperties: true },
    }),
    input: obj('StopAndErrorInput', [], {}),
    output: obj('StopAndErrorOutput', [], { terminated: { type: 'boolean' } }),
  },
  wait: {
    config: obj('WaitConfig', ['mode'], {
      mode: { type: 'string', enum: ['duration','until','webhook'] },
      seconds: { type: 'integer', minimum: 0, maximum: 86400, description: 'For `duration` mode.' },
      timestamp: { type: 'string', format: 'date-time', description: 'For `until` mode.' },
      signatureHint: { type: 'string', description: 'Optional HMAC hint for `webhook` mode (recipe in webhooks.md).' },
    }),
    input: obj('WaitInput', [], {}),
    output: obj('WaitOutput', [], { resumed: { type: 'boolean' }, payload: {} }),
  },
  'sub-workflow-invoke': {
    config: obj('SubWorkflowInvokeConfig', [], {}),
    input: obj('SubWorkflowInvokeInput', ['workflowRef'], {
      workflowRef: { type: 'string', description: 'workflowId or `name@version` reference.' },
      inputs: { type: 'object', additionalProperties: true },
      runOptions: { type: 'object', additionalProperties: true },
    }),
    output: obj('SubWorkflowInvokeOutput', ['result'], { result: {} }),
  },
  ...Object.fromEntries(['resume','ignore','break','commit','rollback'].map((d) => [
    `error-handler-${d}`,
    {
      config: obj(`ErrorHandler${d[0].toUpperCase()+d.slice(1)}Config`, [],
        d === 'resume'
          ? { fallback: { description: 'Fallback bundle to substitute on upstream failure.' } }
          : {}
      ),
      input: obj(`ErrorHandler${d[0].toUpperCase()+d.slice(1)}Input`, ['error'], {
        error: obj('UpstreamError', ['code','message'], {
          code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object', additionalProperties: true },
        }),
      }),
      output: obj(`ErrorHandler${d[0].toUpperCase()+d.slice(1)}Output`, ['directive'], {
        directive: { type: 'string', const: d },
        fallback: {},
        upstreamError: { type: 'object', additionalProperties: true },
      }),
    },
  ])),
};

let count = 0;
for (const [node, parts] of Object.entries(MANIFEST)) {
  for (const part of ['config','input','output']) {
    const file = `${node}.${part}.json`;
    const schema = { ...parts[part], $id: $id(file) };
    // place $id second per existing convention
    const ordered = { $schema: schema.$schema, $id: schema.$id, ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$schema' && k !== '$id')) };
    writeFileSync(join(OUT_DIR, file), JSON.stringify(ordered, null, 2) + '\n');
    count++;
  }
}
console.log(`wrote ${count} schemas to ${OUT_DIR}`);
