/**
 * Sample prompt library shipped with the React example app.
 *
 * Used when the backend doesn't advertise `capabilities.prompts.supported`
 * yet (RFCs 0027/0028/0029 are still Draft). Once a host advertises the
 * capability, `getPrompts()` in `promptsClient.ts` fetches from
 * `GET /v1/prompts` and falls back to this list only on 404/501.
 *
 * Keep this list short and editorial — it's both a demo surface and a
 * reference for downstream prompt-pack authors.
 */

import type { PromptTemplate } from './types.js';

export const SAMPLE_PROMPTS: PromptTemplate[] = [
  {
    templateId: 'writer-system',
    version: '1.0.0',
    kind: 'system',
    name: 'Writer (system)',
    description: 'House-style system prompt for editorial writing.',
    text: 'You are a careful editorial writer. Match the requested tone exactly. Keep paragraphs tight. Do not invent facts.',
    tags: ['editorial', 'writing'],
    modelHints: { modelClass: 'writing', temperature: 0.7 },
    meta: { source: 'host', author: 'openwop-sample' },
  },
  {
    templateId: 'critic-system',
    version: '1.0.0',
    kind: 'system',
    name: 'Critic (system)',
    description: 'Adversarial editor system prompt — finds weak claims and unsupported assertions.',
    text: 'You are a sharp editor. Read the draft and list the three weakest claims with one-line rationales each. Be terse. Do not rewrite.',
    tags: ['editorial', 'review'],
    modelHints: { modelClass: 'reasoning', temperature: 0.2 },
    meta: { source: 'host' },
  },
  {
    templateId: 'editor-system',
    version: '1.0.0',
    kind: 'system',
    name: 'Editor (system)',
    description: 'Final-pass editor system prompt — incorporates critic feedback into a polished draft.',
    text: 'You are an editor. Apply the critic notes to the draft. Preserve voice. Output only the revised draft, nothing else.',
    tags: ['editorial', 'final-pass'],
    modelHints: { modelClass: 'writing', temperature: 0.3 },
    meta: { source: 'host' },
  },
  {
    templateId: 'writer-user',
    version: '1.0.0',
    kind: 'user',
    name: 'Writer (user template)',
    description: 'Draft request with topic + tone + length variables.',
    text: 'Write about: {{topic}}\n\nTone: {{tone}}\nLength: {{length}} words.',
    variables: [
      { name: 'topic', type: 'string', required: true, source: 'input' },
      { name: 'tone', type: 'string', required: false, source: 'input', defaultValue: 'neutral' },
      { name: 'length', type: 'number', required: false, source: 'input', defaultValue: 250 },
    ],
    tags: ['editorial', 'writing'],
    meta: { source: 'host' },
  },
  {
    templateId: 'json-extractor-system',
    version: '1.0.0',
    kind: 'system',
    name: 'JSON Extractor (system)',
    description: 'Strict JSON-only extractor. Pair with a schema-hint template.',
    text: 'You extract structured data from text. Respond with ONLY a JSON object matching the requested schema. No prose. No markdown fences.',
    tags: ['data', 'extraction'],
    modelHints: { modelClass: 'classification', temperature: 0 },
    meta: { source: 'host' },
  },
];
