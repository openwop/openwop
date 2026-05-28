/**
 * core.openwop.rag — RAG primitives. Composes with core.openwop.ai
 * (embeddings) + core.openwop.db (vector ops) + core.openwop.http (loaders).
 *
 * Splitters run pure with stdlib. Loaders + retrievers delegate to host.
 *
 * SSRF defense (closes OPENWOP-AUDIT-2026-002): every outbound fetch
 * is gated by `safeFetch` from this module which resolves the URL,
 * rejects loopback / link-local / RFC-1918 / metadata destinations,
 * and strips sensitive caller headers (Authorization / Cookie /
 * Proxy-Authorization). Opt-out for self-hosted/local-dev:
 *   OPENWOP_HTTP_ALLOW_PRIVATE_RANGES=true
 */

import { lookup } from 'node:dns/promises';

const PRIVATE_V4_RANGES = [
  [0x7F000000, 0xFF000000], [0x0A000000, 0xFF000000], [0xAC100000, 0xFFF00000],
  [0xC0A80000, 0xFFFF0000], [0xA9FE0000, 0xFFFF0000], [0x00000000, 0xFF000000],
  [0x64400000, 0xFFC00000], [0xE0000000, 0xF0000000], [0xF0000000, 0xF0000000],
];

function v4Int(addr) {
  return addr.split('.').reduce((a, p) => (a << 8) | (parseInt(p, 10) & 0xff), 0) >>> 0;
}

function blockedV4(addr) {
  const n = v4Int(addr);
  // `&` returns signed 32-bit — unsigned-coerce before comparing.
  return PRIVATE_V4_RANGES.some(([b, m]) => ((n & m) >>> 0) === b);
}

function blockedV6(addr) {
  const low = addr.toLowerCase();
  if (low === '::1' || low === '::' || low === '0:0:0:0:0:0:0:0' || low === '0:0:0:0:0:0:0:1') return true;
  const v4mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return blockedV4(v4mapped[1]);
  return /^fe[89ab]/.test(low) || /^f[cd]/.test(low) || low.startsWith('ff');
}

const FORBIDDEN_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie']);

function scrubHeaders(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (typeof k === 'string' && !FORBIDDEN_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

async function safeFetch(rawUrl, init = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw Object.assign(new Error(`invalid URL: ${rawUrl}`), { code: 'URL_INVALID' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error(`scheme not allowed: ${u.protocol}`), { code: 'URL_SCHEME_BLOCKED' });
  }
  if (process.env.OPENWOP_HTTP_ALLOW_PRIVATE_RANGES !== 'true') {
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0' || host === '::1') {
      throw Object.assign(new Error(`destination blocked: ${host}`), { code: 'URL_BLOCKED' });
    }
    const isV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    const isV6 = host.includes(':');
    if (isV4 && blockedV4(host)) throw Object.assign(new Error(`destination blocked: ${host}`), { code: 'URL_BLOCKED' });
    else if (isV6 && blockedV6(host)) throw Object.assign(new Error(`destination blocked: ${host}`), { code: 'URL_BLOCKED' });
    else if (!isV4 && !isV6) {
      let addrs;
      try { addrs = await lookup(host, { all: true }); }
      catch (err) { throw Object.assign(new Error(`DNS resolution failed: ${host}: ${err.message}`), { code: 'URL_DNS_FAILED' }); }
      for (const { address, family } of addrs) {
        if (family === 4 && blockedV4(address)) throw Object.assign(new Error(`destination resolves to blocked IP: ${host} → ${address}`), { code: 'URL_BLOCKED' });
        if (family === 6 && blockedV6(address)) throw Object.assign(new Error(`destination resolves to blocked IP: ${host} → ${address}`), { code: 'URL_BLOCKED' });
      }
    }
  }
  const cleanInit = { ...init };
  if (cleanInit.headers) cleanInit.headers = scrubHeaders(cleanInit.headers);
  return fetch(rawUrl, cleanInit);
}

async function fetchUrl(url, headers) {
  const r = await safeFetch(url, { headers });
  const ct = r.headers.get('content-type') || '';
  let content;
  if (ct.includes('application/json')) content = await r.json();
  else content = await r.text();
  return { url, contentType: ct, content, status: r.status };
}

export async function loaderUrl(ctx) {
  const doc = await fetchUrl(ctx.inputs.url, ctx.inputs.headers ?? {});
  return { status: 'success', outputs: { document: doc, contentType: doc.contentType } };
}

export async function loaderFile(ctx) {
  if (typeof ctx.fs?.read !== 'function') throw Object.assign(new Error('host does not implement ctx.fs.read'), { code: 'HOST_CAPABILITY_MISSING' });
  const r = await ctx.fs.read({ path: ctx.inputs.path });
  return { status: 'success', outputs: { document: r } };
}

export async function loaderGithub(ctx) {
  const ref = ctx.config.ref ?? 'main';
  const path = ctx.inputs.path ?? '';
  const url = `https://api.github.com/repos/${ctx.config.repo}/contents/${path}?ref=${ref}`;
  const r = await safeFetch(url, { headers: { accept: 'application/vnd.github+json' } });
  const data = await r.json();
  const docs = (Array.isArray(data) ? data : [data]).map((f) => ({ name: f.name, path: f.path, sha: f.sha, downloadUrl: f.download_url }));
  return { status: 'success', outputs: { documents: docs } };
}

export async function loaderS3(ctx) {
  if (typeof ctx.storage?.blob?.get !== 'function') throw Object.assign(new Error('host does not implement ctx.storage.blob.get'), { code: 'HOST_CAPABILITY_MISSING' });
  const r = await ctx.storage.blob.get({ bucket: ctx.config.bucket, key: ctx.inputs.key });
  return { status: 'success', outputs: { documents: [r] } };
}

function splitRecursive(text, chunkSize, chunkOverlap, separators) {
  const seps = separators?.length ? separators : ['\n\n','\n','. ',' '];
  function recurse(s, idx) {
    if (s.length <= chunkSize) return [s];
    if (idx >= seps.length) return [s.slice(0, chunkSize), ...recurse(s.slice(chunkSize - chunkOverlap), idx)];
    const sep = seps[idx];
    const parts = s.split(sep);
    const out = [];
    let cur = '';
    for (const p of parts) {
      if ((cur + sep + p).length > chunkSize) {
        if (cur) out.push(cur);
        cur = p;
      } else {
        cur = cur ? cur + sep + p : p;
      }
    }
    if (cur) out.push(cur);
    return out.flatMap((piece) => piece.length > chunkSize ? recurse(piece, idx + 1) : [piece]);
  }
  return recurse(text, 0);
}

export async function splitterRecursive(ctx) {
  const chunks = splitRecursive(ctx.inputs.text, ctx.config.chunkSize ?? 1000, ctx.config.chunkOverlap ?? 200, ctx.config.separators);
  return { status: 'success', outputs: { chunks } };
}

export async function splitterCharacter(ctx) {
  const size = ctx.config.chunkSize ?? 1000;
  const overlap = ctx.config.chunkOverlap ?? 0;
  const out = [];
  for (let i = 0; i < ctx.inputs.text.length; i += size - overlap) {
    out.push(ctx.inputs.text.slice(i, i + size));
    if (i + size >= ctx.inputs.text.length) break;
  }
  return { status: 'success', outputs: { chunks: out } };
}

export async function splitterToken(ctx) {
  // Approximate by word count when no tokenizer is provided.
  const words = ctx.inputs.text.split(/\s+/);
  const size = ctx.config.chunkSize ?? 512;
  const overlap = ctx.config.chunkOverlap ?? 50;
  const out = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    out.push(words.slice(i, i + size).join(' '));
    if (i + size >= words.length) break;
  }
  return { status: 'success', outputs: { chunks: out } };
}

async function embed(ctx, text) {
  if (typeof ctx.callAI?.embeddings === 'function') return ctx.callAI.embeddings({ text, model: ctx.config.embeddingModel });
  if (typeof ctx.callEmbeddings === 'function') return ctx.callEmbeddings({ text, model: ctx.config.embeddingModel });
  throw Object.assign(new Error('host does not expose an embeddings surface'), { code: 'HOST_CAPABILITY_MISSING' });
}

export async function ragVectorUpsert(ctx) {
  if (typeof ctx.db?.vector?.upsert !== 'function') throw Object.assign(new Error('host does not implement ctx.db.vector.upsert'), { code: 'HOST_CAPABILITY_MISSING' });
  const records = [];
  for (const d of ctx.inputs.documents) {
    const v = await embed(ctx, d.text);
    records.push({ id: d.id, vector: v.embedding ?? v, metadata: d.metadata ?? {} });
  }
  const r = await ctx.db.vector.upsert({ collection: ctx.config.collection, records });
  return { status: 'success', outputs: r };
}

export async function ragVectorQuery(ctx) {
  if (typeof ctx.db?.vector?.query !== 'function') throw Object.assign(new Error('host does not implement ctx.db.vector.query'), { code: 'HOST_CAPABILITY_MISSING' });
  const v = await embed(ctx, ctx.inputs.query);
  const r = await ctx.db.vector.query({ collection: ctx.config.collection, vector: v.embedding ?? v, topK: ctx.config.topK ?? 10, filter: ctx.inputs.filter });
  return { status: 'success', outputs: r };
}

export async function ragVectorDelete(ctx) {
  if (typeof ctx.db?.vector?.delete !== 'function') throw Object.assign(new Error('host does not implement ctx.db.vector.delete'), { code: 'HOST_CAPABILITY_MISSING' });
  return { status: 'success', outputs: await ctx.db.vector.delete({ collection: ctx.config.collection, ids: ctx.inputs.ids, filter: ctx.inputs.filter }) };
}

export async function retrieverBasic(ctx) {
  return ragVectorQuery({ ...ctx, config: { ...ctx.config, topK: ctx.config.topK ?? 5 } });
}

export async function retrieverMultiQuery(ctx) {
  if (typeof ctx.callAI !== 'function') throw Object.assign(new Error('host does not implement ctx.callAI'), { code: 'HOST_CAPABILITY_MISSING' });
  const n = ctx.config.variants ?? 3;
  const r = await ctx.callAI({ systemPrompt: `Generate ${n} alternative search queries for the following intent. Return one per line, no numbering, no preamble.`, messages: [{ role: 'user', content: ctx.inputs.query }] });
  const variants = (r.text ?? '').split(/\n/).map((s) => s.trim()).filter(Boolean).slice(0, n);
  const all = new Map();
  for (const q of [ctx.inputs.query, ...variants]) {
    const hits = await ragVectorQuery({ ...ctx, inputs: { query: q } });
    for (const h of hits.outputs.hits ?? []) {
      const k = h.id ?? JSON.stringify(h);
      if (!all.has(k) || h.score > all.get(k).score) all.set(k, h);
    }
  }
  return { status: 'success', outputs: { hits: [...all.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), queriesUsed: [ctx.inputs.query, ...variants] } };
}

export async function retrieverContextualCompression(ctx) {
  const hits = await retrieverBasic({ ...ctx });
  if (typeof ctx.callAI !== 'function') return hits;
  const filtered = [];
  for (const h of hits.outputs.hits ?? []) {
    const text = h.text ?? h.metadata?.text ?? '';
    if (!text) { filtered.push(h); continue; }
    const r = await ctx.callAI({ systemPrompt: 'Reply with only "yes" or "no". Is the document relevant to the query?', messages: [{ role: 'user', content: `Query: ${ctx.inputs.query}\n\nDocument: ${text}` }] });
    if ((r.text ?? '').trim().toLowerCase().startsWith('y')) filtered.push(h);
  }
  return { status: 'success', outputs: { hits: filtered, dropped: (hits.outputs.hits?.length ?? 0) - filtered.length } };
}

export const nodes = {
  'core.rag.loader-url': loaderUrl,
  'core.rag.loader-file': loaderFile,
  'core.rag.loader-github': loaderGithub,
  'core.rag.loader-s3': loaderS3,
  'core.rag.splitter-recursive': splitterRecursive,
  'core.rag.splitter-character': splitterCharacter,
  'core.rag.splitter-token': splitterToken,
  'core.rag.vector-upsert': ragVectorUpsert,
  'core.rag.vector-query': ragVectorQuery,
  'core.rag.vector-delete': ragVectorDelete,
  'core.rag.retriever-basic': retrieverBasic,
  'core.rag.retriever-multi-query': retrieverMultiQuery,
  'core.rag.retriever-contextual-compression': retrieverContextualCompression,
};

export default nodes;
