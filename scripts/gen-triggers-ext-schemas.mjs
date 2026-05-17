#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.triggers';
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
  'webhook-respond': {
    c: obj('WebhookRespondConfig', [], {
      status: { type: 'integer', minimum: 100, maximum: 599, default: 200 },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
    }),
    i: obj('WebhookRespondInput', [], { body: {} }),
    o: obj('WebhookRespondOutput', ['responded'], {
      responded: { type: 'boolean' },
      status: { type: 'integer' }, headers: { type: 'object' }, body: {},
    }),
  },
  mailhook: {
    c: obj('MailhookConfig', [], { fromAllowlist: { type: 'array', items: { type: 'string' } }, subjectMatch: { type: 'string' } }),
    i: obj('MailhookInput', [], {}),
    o: obj('MailhookOutput', ['from','subject'], {
      from: { type: 'string' }, to: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' }, text: { type: 'string' }, html: { type: 'string' },
      attachments: { type: 'array', items: { type: 'object', additionalProperties: true } },
      headers: { type: 'object', additionalProperties: true },
    }),
  },
  'email-imap': {
    c: obj('EmailImapConfig', ['host','folder','intervalSeconds'], {
      host: { type: 'string' }, folder: { type: 'string', default: 'INBOX' },
      intervalSeconds: { type: 'integer', minimum: 30, default: 300 },
      filter: { type: 'object', additionalProperties: true },
    }),
    i: obj('EmailImapInput', [], {}),
    o: obj('EmailImapOutput', ['uid','from'], {
      uid: { type: 'string' }, from: { type: 'string' },
      to: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' }, text: { type: 'string' }, html: { type: 'string' },
      attachments: { type: 'array' }, receivedAt: { type: 'string' }, folder: { type: 'string' },
    }),
  },
  form: {
    c: obj('FormConfig', ['formSchema'], {
      formSchema: { type: 'object', additionalProperties: true },
      title: { type: 'string' }, description: { type: 'string' },
    }),
    i: obj('FormInput', [], {}),
    o: obj('FormOutput', ['values'], {
      values: { type: 'object', additionalProperties: true },
      submittedAt: { type: 'string' }, submitterId: { type: 'string' }, submitterEmail: { type: 'string' },
    }),
  },
  rss: {
    c: obj('RssConfig', ['url','intervalSeconds'], {
      url: { type: 'string', format: 'uri' },
      intervalSeconds: { type: 'integer', minimum: 60, default: 900 },
    }),
    i: obj('RssInput', [], {}),
    o: obj('RssOutput', ['title','link'], {
      title: { type: 'string' }, link: { type: 'string' }, description: { type: 'string' },
      content: { type: 'string' }, author: { type: 'string' }, publishedAt: { type: 'string' }, guid: { type: 'string' },
    }),
  },
  manual: {
    c: obj('ManualConfig', [], { label: { type: 'string' } }),
    i: obj('ManualInput', [], {}),
    o: obj('ManualOutput', [], { payload: {} }),
  },
  error: {
    c: obj('ErrorConfig', [], {
      workflowIdFilter: { type: 'string' },
      errorCodeFilter: { type: 'string' },
    }),
    i: obj('ErrorInput', [], {}),
    o: obj('ErrorOutput', ['failedRunId'], {
      failedRunId: { type: 'string' }, workflowId: { type: 'string' }, failedNodeId: { type: 'string' },
      errorEnvelope: { type: 'object', additionalProperties: true },
    }),
  },
  'sub-workflow': {
    c: obj('SubWorkflowConfig', [], { label: { type: 'string' }, inputSchema: { type: 'object', additionalProperties: true } }),
    i: obj('SubWorkflowInput', [], {}),
    o: obj('SubWorkflowOutput', ['parentRunId'], {
      parentRunId: { type: 'string' }, parentNodeId: { type: 'string' },
      inputs: { type: 'object', additionalProperties: true }, invokedBy: { type: 'string' },
    }),
  },
  'cron-advanced': {
    c: obj('CronAdvancedConfig', [], {
      rrule: { type: 'string' }, cron: { type: 'string' }, timezone: { type: 'string', default: 'UTC' },
      holidayCalendar: { type: 'string' },
    }),
    i: obj('CronAdvancedInput', [], {}),
    o: obj('CronAdvancedOutput', [], {
      rrule: { type: 'string' }, cron: { type: 'string' }, timezone: { type: 'string' }, isCatchUp: { type: 'boolean' },
    }),
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
