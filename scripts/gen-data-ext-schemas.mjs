#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.data';
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

const NUM = { type: 'number' };
const STR = { type: 'string' };
const BOOL = { type: 'boolean' };
const ANY = {};

const M = {
  'string-format': {
    c: obj('StringFormatConfig', [], {}),
    i: obj('StringFormatInput', ['template'], { template: STR, context: { type: 'object', additionalProperties: true } }),
    o: obj('StringFormatOutput', ['text'], { text: STR }),
  },
  'string-regex-match': {
    c: obj('StringRegexMatchConfig', ['pattern'], { pattern: STR, flags: STR }),
    i: obj('StringRegexMatchInput', ['text'], { text: STR }),
    o: obj('StringRegexMatchOutput', ['matched'], { matched: BOOL, match: { type: ['string','null'] }, groups: { type: 'array' }, named: { type: 'object', additionalProperties: true } }),
  },
  'string-regex-replace': {
    c: obj('StringRegexReplaceConfig', ['pattern'], { pattern: STR, flags: STR, replacement: STR }),
    i: obj('StringRegexReplaceInput', ['text'], { text: STR }),
    o: obj('StringRegexReplaceOutput', ['text'], { text: STR }),
  },
  'string-regex-extract': {
    c: obj('StringRegexExtractConfig', ['pattern'], { pattern: STR, flags: STR }),
    i: obj('StringRegexExtractInput', ['text'], { text: STR }),
    o: obj('StringRegexExtractOutput', ['matches','count'], { matches: { type: 'array' }, count: { type: 'integer' } }),
  },
  'string-encode': {
    c: obj('StringEncodeConfig', ['to'], {
      from: { type: 'string', enum: ['utf8','hex','base64','base64url','ascii'], default: 'utf8' },
      to: { type: 'string', enum: ['utf8','hex','base64','base64url','ascii'] },
    }),
    i: obj('StringEncodeInput', ['text'], { text: STR }),
    o: obj('StringEncodeOutput', ['text'], { text: STR }),
  },
  'array-sort': {
    c: obj('ArraySortConfig', ['keys'], {
      keys: { type: 'array', minItems: 1, items: obj('SortKey', ['path'], {
        path: STR, direction: { type: 'string', enum: ['asc','desc'], default: 'asc' },
        compare: { type: 'string', enum: ['default','natural'], default: 'default' },
      }) },
    }),
    i: obj('ArraySortInput', ['array'], { array: { type: 'array' } }),
    o: obj('ArraySortOutput', ['array'], { array: { type: 'array' } }),
  },
  'array-unique': {
    c: obj('ArrayUniqueConfig', [], { path: STR }),
    i: obj('ArrayUniqueInput', ['array'], { array: { type: 'array' } }),
    o: obj('ArrayUniqueOutput', ['array','dropped'], { array: { type: 'array' }, dropped: { type: 'integer' } }),
  },
  'array-flatten': {
    c: obj('ArrayFlattenConfig', [], { depth: { type: 'integer', minimum: 1, default: 1 } }),
    i: obj('ArrayFlattenInput', ['array'], { array: { type: 'array' } }),
    o: obj('ArrayFlattenOutput', ['array'], { array: { type: 'array' } }),
  },
  'array-chunk': {
    c: obj('ArrayChunkConfig', ['size'], { size: { type: 'integer', minimum: 1 } }),
    i: obj('ArrayChunkInput', ['array'], { array: { type: 'array' } }),
    o: obj('ArrayChunkOutput', ['chunks','chunkCount'], { chunks: { type: 'array', items: { type: 'array' } }, chunkCount: { type: 'integer' } }),
  },
  'array-zip': {
    c: obj('ArrayZipConfig', [], {}),
    i: obj('ArrayZipInput', ['arrays'], { arrays: { type: 'array', items: { type: 'array' } } }),
    o: obj('ArrayZipOutput', ['array'], { array: { type: 'array' } }),
  },
  'array-reduce': {
    c: obj('ArrayReduceConfig', ['op'], {
      op: { type: 'string', enum: ['sum','product','concat','count'] },
      initial: ANY, path: STR,
    }),
    i: obj('ArrayReduceInput', ['array'], { array: { type: 'array' } }),
    o: obj('ArrayReduceOutput', ['result'], { result: ANY }),
  },
  'object-pick': {
    c: obj('ObjectPickConfig', ['keys'], { keys: { type: 'array', items: STR } }),
    i: obj('ObjectPickInput', ['object'], { object: { type: 'object', additionalProperties: true } }),
    o: obj('ObjectPickOutput', ['object'], { object: { type: 'object', additionalProperties: true } }),
  },
  'object-omit': {
    c: obj('ObjectOmitConfig', ['keys'], { keys: { type: 'array', items: STR } }),
    i: obj('ObjectOmitInput', ['object'], { object: { type: 'object', additionalProperties: true } }),
    o: obj('ObjectOmitOutput', ['object'], { object: { type: 'object', additionalProperties: true } }),
  },
  'object-rename-keys': {
    c: obj('ObjectRenameKeysConfig', ['map'], { map: { type: 'object', additionalProperties: STR } }),
    i: obj('ObjectRenameKeysInput', ['object'], { object: { type: 'object', additionalProperties: true } }),
    o: obj('ObjectRenameKeysOutput', ['object'], { object: { type: 'object', additionalProperties: true } }),
  },
  'object-get-path': {
    c: obj('ObjectGetPathConfig', ['path'], { path: STR }),
    i: obj('ObjectGetPathInput', ['object'], { object: { type: 'object', additionalProperties: true } }),
    o: obj('ObjectGetPathOutput', ['present'], { value: ANY, present: BOOL }),
  },
  'object-set-path': {
    c: obj('ObjectSetPathConfig', ['path'], { path: STR }),
    i: obj('ObjectSetPathInput', ['object','value'], { object: { type: 'object', additionalProperties: true }, value: ANY }),
    o: obj('ObjectSetPathOutput', ['object'], { object: { type: 'object', additionalProperties: true } }),
  },
  'json-parse': {
    c: obj('JsonParseConfig', [], { failOnError: { type: 'boolean', default: true } }),
    i: obj('JsonParseInput', ['text'], { text: STR }),
    o: obj('JsonParseOutput', [], { value: ANY, error: { type: ['string','null'] } }),
  },
  'json-stringify': {
    c: obj('JsonStringifyConfig', [], { indent: { type: 'integer', minimum: 0, default: 0 } }),
    i: obj('JsonStringifyInput', ['value'], { value: ANY }),
    o: obj('JsonStringifyOutput', ['text'], { text: STR }),
  },
  'json-schema-validate': {
    c: obj('JsonSchemaValidateConfig', [], {}),
    i: obj('JsonSchemaValidateInput', ['value','schema'], { value: ANY, schema: { type: 'object', additionalProperties: true } }),
    o: obj('JsonSchemaValidateOutput', ['valid','errors'], { valid: BOOL, errors: { type: 'array', items: { type: 'object', additionalProperties: true } } }),
  },
  'jsonpath-query': {
    c: obj('JsonpathQueryConfig', ['path'], { path: STR }),
    i: obj('JsonpathQueryInput', ['value'], { value: ANY }),
    o: obj('JsonpathQueryOutput', ['results','count'], { results: { type: 'array' }, count: { type: 'integer' } }),
  },
  'csv-parse': {
    c: obj('CsvParseConfig', [], { hasHeader: { type: 'boolean', default: true } }),
    i: obj('CsvParseInput', ['text'], { text: STR }),
    o: obj('CsvParseOutput', ['rows','headers'], { rows: { type: 'array' }, headers: { type: 'array', items: STR } }),
  },
  'csv-stringify': {
    c: obj('CsvStringifyConfig', [], { headers: { type: 'array', items: STR }, emitHeader: { type: 'boolean', default: true } }),
    i: obj('CsvStringifyInput', ['rows'], { rows: { type: 'array' } }),
    o: obj('CsvStringifyOutput', ['text'], { text: STR }),
  },
  'datetime-now': {
    c: obj('DatetimeNowConfig', [], { timezone: STR }),
    i: obj('DatetimeNowInput', [], {}),
    o: obj('DatetimeNowOutput', ['iso','epochMs'], { iso: STR, epochMs: { type: 'integer' }, epochSec: { type: 'integer' }, timezone: STR }),
  },
  'datetime-parse': {
    c: obj('DatetimeParseConfig', [], {}),
    i: obj('DatetimeParseInput', ['text'], { text: STR }),
    o: obj('DatetimeParseOutput', ['valid'], { valid: BOOL, iso: { type: ['string','null'] }, epochMs: { type: ['integer','null'] } }),
  },
  'datetime-format': {
    c: obj('DatetimeFormatConfig', [], { format: { type: 'string', enum: ['iso','rfc2822','epoch-ms','epoch-s','locale'], default: 'iso' }, timezone: STR, locale: STR }),
    i: obj('DatetimeFormatInput', ['timestamp'], { timestamp: ANY }),
    o: obj('DatetimeFormatOutput', ['text'], { text: STR }),
  },
  'datetime-add': {
    c: obj('DatetimeAddConfig', ['amount','unit'], { amount: NUM, unit: { type: 'string', enum: ['ms','s','m','h','d','w'] } }),
    i: obj('DatetimeAddInput', ['timestamp'], { timestamp: ANY }),
    o: obj('DatetimeAddOutput', ['iso','epochMs'], { iso: STR, epochMs: { type: 'integer' } }),
  },
  'datetime-diff': {
    c: obj('DatetimeDiffConfig', [], { unit: { type: 'string', enum: ['ms','s','m','h','d','w'], default: 's' } }),
    i: obj('DatetimeDiffInput', ['a','b'], { a: ANY, b: ANY }),
    o: obj('DatetimeDiffOutput', ['diff','diffMs','unit'], { diff: NUM, diffMs: { type: 'integer' }, unit: STR }),
  },
  'datetime-timezone': {
    c: obj('DatetimeTimezoneConfig', ['timezone'], { timezone: STR }),
    i: obj('DatetimeTimezoneInput', ['timestamp'], { timestamp: ANY }),
    o: obj('DatetimeTimezoneOutput', ['text','timezone'], { text: STR, timezone: STR }),
  },
  'number-format': {
    c: obj('NumberFormatConfig', [], {
      locale: STR, minimumFractionDigits: { type: 'integer', minimum: 0 }, maximumFractionDigits: { type: 'integer', minimum: 0 },
      style: { type: 'string', enum: ['decimal','currency','percent','unit'] }, currency: STR,
    }),
    i: obj('NumberFormatInput', ['value'], { value: NUM }),
    o: obj('NumberFormatOutput', ['text'], { text: STR }),
  },
  'number-round': {
    c: obj('NumberRoundConfig', [], { places: { type: 'integer', default: 0 }, mode: { type: 'string', enum: ['half-up','floor','ceil','trunc'], default: 'half-up' } }),
    i: obj('NumberRoundInput', ['value'], { value: NUM }),
    o: obj('NumberRoundOutput', ['value'], { value: NUM }),
  },
  'number-clamp': {
    c: obj('NumberClampConfig', [], { min: NUM, max: NUM }),
    i: obj('NumberClampInput', ['value'], { value: NUM }),
    o: obj('NumberClampOutput', ['value'], { value: NUM }),
  },
  uuid: {
    c: obj('UuidConfig', [], {}),
    i: obj('UuidInput', [], {}),
    o: obj('UuidOutput', ['uuid'], { uuid: STR }),
  },
};

let count = 0;
const manifestEntries = [];
for (const [node, parts] of Object.entries(M)) {
  for (const [k, schema] of [['config', parts.c], ['input', parts.i], ['output', parts.o]]) {
    const f = `${node}.${k}.json`;
    const ordered = { $schema: schema.$schema, $id: $id(f), ...Object.fromEntries(Object.entries(schema).filter(([x]) => x !== '$schema' && x !== '$id')) };
    writeFileSync(join(OUT, f), JSON.stringify(ordered, null, 2) + '\n');
    count++;
  }
  manifestEntries.push({
    typeId: `core.openwop.data.${node}`, version: '1.0.0',
    label: parts.c.title.replace(/Config$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'),
    description: `v1.1 data utility — ${node}.`,
    category: 'data', role: 'pure', capabilities: ['cacheable'],
    configSchemaRef: `schemas/${node}.config.json`,
    inputSchemaRef: `schemas/${node}.input.json`,
    outputSchemaRef: `schemas/${node}.output.json`,
  });
}
writeFileSync(join('packs', PACK, 'v1.1-nodes.json'), JSON.stringify(manifestEntries, null, 2) + '\n');
console.log(`wrote ${count} schemas + manifest fragment with ${manifestEntries.length} nodes`);
