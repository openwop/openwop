#!/usr/bin/env node
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

function emit(pack, prefix, ver, manifest, mode = 'replace') {
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
      typeId: `${prefix}.${node}`,
      version: '1.0.0',
      label: def.label,
      description: def.description,
      category: def.category || 'data',
      role: def.role || 'side-effect',
      capabilities: def.capabilities || ['cacheable', 'side-effectful'],
      configSchemaRef: `schemas/${node}.config.json`,
      inputSchemaRef: `schemas/${node}.input.json`,
      outputSchemaRef: `schemas/${node}.output.json`,
    });
  }
  const path = join('packs', pack, 'pack.json');
  const j = JSON.parse(readFileSync(path, 'utf8'));
  if (mode === 'replace') j.nodes = entries;
  else j.nodes = [...j.nodes, ...entries];
  writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  return { pack, schemas: schemaCount, nodes: entries.length };
}

/* ─── AI extensions ──────────────────────────────────────────── */

const aiExt = {
  'image-generate': {
    label: 'AI Image Generate', description: 'Image generation via host.aiProviders.imageGeneration (e.g., DALL·E / Imagen / SD).',
    c: obj('AiImageGenerateConfig', [], { model: STR, size: STR, n: { type: 'integer', default: 1 } }),
    i: obj('AiImageGenerateInput', ['prompt'], { prompt: STR, negativePrompt: STR }),
    o: obj('AiImageGenerateOutput', ['images'], { images: { type: 'array', items: obj('GenImg', ['contentBase64'], { contentBase64: STR, contentType: STR, width: INT, height: INT }) } }),
  },
  'image-edit': {
    label: 'AI Image Edit', description: 'Inpaint / mask-based edit.',
    c: obj('AiImageEditConfig', [], { model: STR }),
    i: obj('AiImageEditInput', ['imageBase64','prompt'], { imageBase64: STR, maskBase64: STR, prompt: STR }),
    o: obj('AiImageEditOutput', ['contentBase64'], { contentBase64: STR, contentType: STR }),
  },
  'image-upscale': {
    label: 'AI Image Upscale', description: '2x/4x upscale.',
    c: obj('AiImageUpscaleConfig', [], { scale: { type: 'integer', enum: [2,4], default: 2 } }),
    i: obj('AiImageUpscaleInput', ['imageBase64'], { imageBase64: STR }),
    o: obj('AiImageUpscaleOutput', ['contentBase64'], { contentBase64: STR, contentType: STR }),
  },
  'audio-transcribe': {
    label: 'AI Audio Transcribe', description: 'STT via host.aiProviders. Returns text + segments.',
    c: obj('AiAudioTranscribeConfig', [], { model: STR, language: STR }),
    i: obj('AiAudioTranscribeInput', ['audioBase64'], { audioBase64: STR, contentType: STR }),
    o: obj('AiAudioTranscribeOutput', ['text'], { text: STR, segments: { type: 'array' } }),
  },
  'audio-synthesize': {
    label: 'AI Audio Synthesize', description: 'TTS via host.aiProviders.',
    c: obj('AiAudioSynthesizeConfig', [], { model: STR, voice: STR }),
    i: obj('AiAudioSynthesizeInput', ['text'], { text: STR }),
    o: obj('AiAudioSynthesizeOutput', ['audioBase64'], { audioBase64: STR, contentType: STR, durationMs: INT }),
  },
  'video-generate': {
    label: 'AI Video Generate', description: 'Video generation via host.aiProviders.videoGeneration.',
    c: obj('AiVideoGenerateConfig', [], { model: STR, durationSec: { type: 'integer', default: 5 } }),
    i: obj('AiVideoGenerateInput', ['prompt'], { prompt: STR, seedImageBase64: STR }),
    o: obj('AiVideoGenerateOutput', ['videoBase64'], { videoBase64: STR, contentType: STR, durationSec: INT }),
  },
  rerank: {
    label: 'AI Rerank', description: 'Rerank candidate documents by query relevance.',
    c: obj('AiRerankConfig', [], { model: STR, topN: { type: 'integer', default: 10 } }),
    i: obj('AiRerankInput', ['query','documents'], { query: STR, documents: { type: 'array', items: STR } }),
    o: obj('AiRerankOutput', ['results'], { results: { type: 'array', items: obj('RR', ['index','score'], { index: INT, score: NUM, document: STR }) } }),
  },
  classify: {
    label: 'AI Classify', description: 'Single-label classifier via LLM. Returns top label + confidence.',
    c: obj('AiClassifyConfig', ['labels'], { labels: { type: 'array', items: STR }, model: STR }),
    i: obj('AiClassifyInput', ['text'], { text: STR }),
    o: obj('AiClassifyOutput', ['label'], { label: STR, confidence: NUM, allScores: { type: 'array' } }),
  },
  extract: {
    label: 'AI Extract', description: 'Schema-driven information extraction.',
    c: obj('AiExtractConfig', ['schema'], { schema: META, model: STR }),
    i: obj('AiExtractInput', ['text'], { text: STR }),
    o: obj('AiExtractOutput', ['value'], { value: ANY, confidence: NUM }),
  },
  guardrails: {
    label: 'AI Guardrails', description: 'PII / toxicity / topic filter. Pure-ish (uses optional ctx.guardrails or returns pass-through).',
    c: obj('AiGuardrailsConfig', [], { checks: { type: 'array', items: { type: 'string', enum: ['pii','toxicity','topic','prompt-injection'] } } }),
    i: obj('AiGuardrailsInput', ['text'], { text: STR }),
    o: obj('AiGuardrailsOutput', ['passed'], { passed: BOOL, violations: { type: 'array' } }),
  },
  transform: {
    label: 'AI Transform', description: 'LLM-backed field transformer with examples.',
    c: obj('AiTransformConfig', [], { model: STR, examples: { type: 'array' } }),
    i: obj('AiTransformInput', ['value','instruction'], { value: ANY, instruction: STR }),
    o: obj('AiTransformOutput', ['result'], { result: ANY }),
  },
};

/* ─── Agents pack ────────────────────────────────────────────── */

const FLAT_SCHEMA = { type: 'object', additionalProperties: true };

const agents = {
  run: {
    label: 'Agent Run', description: 'Root agent loop. Reads sub-nodes (tools, memory, model). Iterates until terminal output or max steps. Streaming-output emits per-step events.',
    role: 'streaming-output', capabilities: ['cacheable','side-effectful','streamable'],
    c: obj('AgentRunConfig', [], {
      maxSteps: { type: 'integer', default: 10 },
      strategy: { type: 'string', enum: ['tools','react','plan-execute'], default: 'tools' },
      systemPrompt: STR,
    }),
    i: obj('AgentRunInput', ['userPrompt'], {
      userPrompt: STR,
      tools: { type: 'array', items: META },
      memory: META,
      modelSelectorOutput: META,
      outputParser: META,
    }),
    o: obj('AgentRunOutput', ['result'], {
      result: ANY, finalMessage: STR, steps: { type: 'array' }, toolCalls: { type: 'array' },
      usage: META, finishReason: STR,
    }),
  },
  'tool-function': {
    label: 'Tool — Function', description: 'Declarative tool: name + JSON-Schema input + handler reference.',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('ToolFunctionConfig', ['name','description','inputSchema'], {
      name: STR, description: STR, inputSchema: FLAT_SCHEMA, handler: STR,
    }),
    i: obj('ToolFunctionInput', [], {}),
    o: obj('ToolFunctionOutput', ['tool'], { tool: META }),
  },
  'tool-workflow': {
    label: 'Tool — Workflow', description: 'Wraps another workflow as an agent tool.',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('ToolWorkflowConfig', ['name','workflowRef'], {
      name: STR, description: STR, workflowRef: STR, inputSchema: FLAT_SCHEMA,
    }),
    i: obj('ToolWorkflowInput', [], {}),
    o: obj('ToolWorkflowOutput', ['tool'], { tool: META }),
  },
  'tool-mcp': {
    label: 'Tool — MCP', description: 'Wraps an MCP tool from a connected server.',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('ToolMcpConfig', ['serverId','toolName'], { serverId: STR, toolName: STR }),
    i: obj('ToolMcpInput', [], {}),
    o: obj('ToolMcpOutput', ['tool'], { tool: META }),
  },
  'tool-http': {
    label: 'Tool — HTTP', description: 'Wraps an OpenAPI operation as an agent tool.',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('ToolHttpConfig', ['name','operationId'], {
      name: STR, operationId: STR, description: STR, openapi: META,
    }),
    i: obj('ToolHttpInput', [], {}),
    o: obj('ToolHttpOutput', ['tool'], { tool: META }),
  },
  'memory-window': {
    label: 'Memory — Window', description: 'Recent-N-message buffer.',
    role: 'side-effect', capabilities: ['cacheable','side-effectful'],
    c: obj('MemoryWindowConfig', [], { windowSize: { type: 'integer', default: 10 } }),
    i: obj('MemoryWindowInput', ['sessionId'], { sessionId: STR }),
    o: obj('MemoryWindowOutput', ['memory'], { memory: META }),
  },
  'memory-summary': {
    label: 'Memory — Summary', description: 'LLM-rollup summary memory.',
    role: 'side-effect', capabilities: ['cacheable','side-effectful'],
    c: obj('MemorySummaryConfig', [], { model: STR, summarizeEvery: { type: 'integer', default: 10 } }),
    i: obj('MemorySummaryInput', ['sessionId'], { sessionId: STR }),
    o: obj('MemorySummaryOutput', ['memory'], { memory: META }),
  },
  'memory-kv-store': {
    label: 'Memory — KV-store', description: 'Long-lived KV-backed memory via core.openwop.storage.',
    role: 'side-effect', capabilities: ['cacheable','side-effectful'],
    c: obj('MemoryKvStoreConfig', [], { namespace: STR, ttlSeconds: INT }),
    i: obj('MemoryKvStoreInput', ['sessionId'], { sessionId: STR }),
    o: obj('MemoryKvStoreOutput', ['memory'], { memory: META }),
  },
  'output-parser-structured': {
    label: 'Output Parser — Structured', description: 'JSON-Schema-typed output validator (uses core.openwop.data.json-schema-validate).',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('OutputParserStructuredConfig', ['schema'], { schema: META }),
    i: obj('OutputParserStructuredInput', [], {}),
    o: obj('OutputParserStructuredOutput', ['parser'], { parser: META }),
  },
  'output-parser-list': {
    label: 'Output Parser — List', description: 'Newline-delimited list parser.',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('OutputParserListConfig', [], { separator: { type: 'string', default: '\n' } }),
    i: obj('OutputParserListInput', [], {}),
    o: obj('OutputParserListOutput', ['parser'], { parser: META }),
  },
  'output-parser-auto-fix': {
    label: 'Output Parser — Auto-Fix', description: 'Retries with parser feedback on validation failure.',
    role: 'side-effect', capabilities: ['side-effectful'],
    c: obj('OutputParserAutoFixConfig', [], { maxRetries: { type: 'integer', default: 2 }, model: STR }),
    i: obj('OutputParserAutoFixInput', ['innerParser'], { innerParser: META }),
    o: obj('OutputParserAutoFixOutput', ['parser'], { parser: META }),
  },
  'model-selector': {
    label: 'Model Selector', description: 'Dynamic model routing.',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('ModelSelectorConfig', ['rules'], { rules: { type: 'array', items: META }, fallbackModel: STR }),
    i: obj('ModelSelectorInput', [], { userPrompt: STR, taskHint: STR }),
    o: obj('ModelSelectorOutput', ['model'], { model: STR, rationale: STR }),
  },
};

/* ─── RAG pack ───────────────────────────────────────────────── */

const rag = {
  'loader-url': {
    label: 'Loader — URL', description: 'Fetch and parse a URL into a Document.',
    c: obj('LoaderUrlConfig', [], { selector: STR, stripScripts: { type: 'boolean', default: true } }),
    i: obj('LoaderUrlInput', ['url'], { url: { type: 'string', format: 'uri' }, headers: { type: 'object', additionalProperties: STR } }),
    o: obj('LoaderUrlOutput', ['document'], { document: META, contentType: STR }),
  },
  'loader-file': {
    label: 'Loader — File', description: 'Load a file (delegates to core.files.read).',
    c: obj('LoaderFileConfig', [], {}),
    i: obj('LoaderFileInput', ['path'], { path: STR }),
    o: obj('LoaderFileOutput', ['document'], { document: META }),
  },
  'loader-github': {
    label: 'Loader — GitHub', description: 'Load a repo path (files or a directory).',
    c: obj('LoaderGithubConfig', ['repo'], { repo: STR, ref: STR, glob: STR }),
    i: obj('LoaderGithubInput', [], { path: STR }),
    o: obj('LoaderGithubOutput', ['documents'], { documents: { type: 'array', items: META } }),
  },
  'loader-s3': {
    label: 'Loader — S3', description: 'Load object(s) from S3 (delegates to host.blobStorage).',
    c: obj('LoaderS3Config', ['bucket'], { bucket: STR, prefix: STR }),
    i: obj('LoaderS3Input', [], { key: STR }),
    o: obj('LoaderS3Output', ['documents'], { documents: { type: 'array', items: META } }),
  },
  'splitter-recursive': {
    label: 'Splitter — Recursive Character', description: 'Recursive character splitter (paragraph/sentence/word).',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('SplitterRecursiveConfig', [], { chunkSize: { type: 'integer', default: 1000 }, chunkOverlap: { type: 'integer', default: 200 }, separators: { type: 'array', items: STR } }),
    i: obj('SplitterRecursiveInput', ['text'], { text: STR }),
    o: obj('SplitterRecursiveOutput', ['chunks'], { chunks: { type: 'array', items: STR } }),
  },
  'splitter-character': {
    label: 'Splitter — Character', description: 'Fixed-window character splitter.',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('SplitterCharacterConfig', [], { chunkSize: { type: 'integer', default: 1000 }, chunkOverlap: { type: 'integer', default: 0 } }),
    i: obj('SplitterCharacterInput', ['text'], { text: STR }),
    o: obj('SplitterCharacterOutput', ['chunks'], { chunks: { type: 'array', items: STR } }),
  },
  'splitter-token': {
    label: 'Splitter — Token', description: 'Token-based splitter (approx via word count when no tokenizer present).',
    role: 'pure', capabilities: ['cacheable'],
    c: obj('SplitterTokenConfig', [], { chunkSize: { type: 'integer', default: 512 }, chunkOverlap: { type: 'integer', default: 50 }, tokenizer: STR }),
    i: obj('SplitterTokenInput', ['text'], { text: STR }),
    o: obj('SplitterTokenOutput', ['chunks'], { chunks: { type: 'array', items: STR } }),
  },
  'vector-upsert': {
    label: 'RAG Vector Upsert', description: 'Thin wrapper over core.db.vector-upsert that auto-embeds text.',
    c: obj('RagVectorUpsertConfig', ['collection'], { collection: STR, embeddingModel: STR }),
    i: obj('RagVectorUpsertInput', ['documents'], { documents: { type: 'array', items: obj('Doc', ['id','text'], { id: STR, text: STR, metadata: META }) } }),
    o: obj('RagVectorUpsertOutput', ['upserted'], { upserted: INT }),
  },
  'vector-query': {
    label: 'RAG Vector Query', description: 'Auto-embed query + run k-NN.',
    c: obj('RagVectorQueryConfig', ['collection'], { collection: STR, embeddingModel: STR, topK: { type: 'integer', default: 10 } }),
    i: obj('RagVectorQueryInput', ['query'], { query: STR, filter: META }),
    o: obj('RagVectorQueryOutput', ['hits'], { hits: { type: 'array' } }),
  },
  'vector-delete': {
    label: 'RAG Vector Delete', description: 'Wrapper over core.db.vector-delete.',
    c: obj('RagVectorDeleteConfig', ['collection'], { collection: STR }),
    i: obj('RagVectorDeleteInput', [], { ids: { type: 'array', items: STR }, filter: META }),
    o: obj('RagVectorDeleteOutput', ['deleted'], { deleted: INT }),
  },
  'retriever-basic': {
    label: 'Retriever — Basic', description: 'Single vector-query.',
    c: obj('RetrieverBasicConfig', ['collection'], { collection: STR, topK: { type: 'integer', default: 5 } }),
    i: obj('RetrieverBasicInput', ['query'], { query: STR }),
    o: obj('RetrieverBasicOutput', ['hits'], { hits: { type: 'array' } }),
  },
  'retriever-multi-query': {
    label: 'Retriever — Multi-Query', description: 'Generates N query variants via LLM, retrieves each, merges + dedupes.',
    c: obj('RetrieverMultiQueryConfig', ['collection'], { collection: STR, topK: INT, variants: { type: 'integer', default: 3 }, model: STR }),
    i: obj('RetrieverMultiQueryInput', ['query'], { query: STR }),
    o: obj('RetrieverMultiQueryOutput', ['hits'], { hits: { type: 'array' }, queriesUsed: { type: 'array', items: STR } }),
  },
  'retriever-contextual-compression': {
    label: 'Retriever — Contextual Compression', description: 'Post-filters retrieved chunks via LLM relevance scoring.',
    c: obj('RetrieverContextualCompressionConfig', ['collection'], { collection: STR, topK: INT, model: STR }),
    i: obj('RetrieverContextualCompressionInput', ['query'], { query: STR }),
    o: obj('RetrieverContextualCompressionOutput', ['hits'], { hits: { type: 'array' }, dropped: INT }),
  },
};

/* ─── Integration extension ──────────────────────────────────── */

const integrationExt = {
  'chat-message-generic': {
    label: 'Chat Message Generic', description: 'Provider-neutral chat-room post via host.messaging.dispatchEgressEnvelope.',
    c: obj('ChatMessageGenericConfig', [], { connectorInstanceId: STR }),
    i: obj('ChatMessageGenericInput', ['channel','text','conversationId'], { channel: STR, text: STR, conversationId: STR, threadId: STR, media: { type: 'array' } }),
    o: obj('ChatMessageGenericOutput', ['success'], { success: BOOL, deliveryId: STR, platformMessageId: STR }),
  },
  'sms-send': {
    label: 'SMS Send', description: 'Send an SMS via host.messaging.',
    c: obj('SmsSendConfig', [], { provider: { type: 'string', enum: ['twilio','vonage','aws-sns','generic'], default: 'generic' } }),
    i: obj('SmsSendInput', ['to','text'], { to: STR, text: STR, from: STR }),
    o: obj('SmsSendOutput', ['success'], { success: BOOL, messageId: STR }),
  },
  'voice-call-place': {
    label: 'Voice Call — Place', description: 'Place an outbound voice call.',
    c: obj('VoiceCallPlaceConfig', [], { provider: STR }),
    i: obj('VoiceCallPlaceInput', ['to'], { to: STR, from: STR, twiml: STR, callbackUrl: STR }),
    o: obj('VoiceCallPlaceOutput', ['callId'], { callId: STR, status: STR }),
  },
  'voice-call-tts-greet': {
    label: 'Voice Call — TTS Greet', description: 'Play a TTS greeting on a connected call.',
    c: obj('VoiceCallTtsGreetConfig', [], { voice: STR }),
    i: obj('VoiceCallTtsGreetInput', ['callId','text'], { callId: STR, text: STR }),
    o: obj('VoiceCallTtsGreetOutput', ['played'], { played: BOOL }),
  },
  'notification-push': {
    label: 'Push Notification', description: 'APNS / FCM push notification delivery.',
    c: obj('NotificationPushConfig', [], { provider: { type: 'string', enum: ['apns','fcm','generic'], default: 'generic' } }),
    i: obj('NotificationPushInput', ['deviceToken','title'], { deviceToken: STR, title: STR, body: STR, data: META }),
    o: obj('NotificationPushOutput', ['delivered'], { delivered: BOOL, messageId: STR }),
  },
};

const results = [
  emit('core.openwop.ai', 'core.openwop.ai', '1.1.0', aiExt, 'append'),
  emit('core.openwop.agents', 'core.agents', '1.0.0', agents, 'replace'),
  emit('core.openwop.rag', 'core.rag', '1.0.0', rag, 'replace'),
  emit('core.openwop.integration', 'core.openwop.integration', '1.1.0', integrationExt, 'append'),
];
for (const r of results) console.log(`${r.pack}: ${r.nodes} new nodes, ${r.schemas} schemas`);
