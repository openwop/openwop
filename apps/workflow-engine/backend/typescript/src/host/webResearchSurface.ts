/**
 * `ctx.webResearch` host surface (`host.webResearch`,
 * `spec/v1/host-capabilities.md` §host.webResearch) — the
 * `vendor.myndhyve.web-research` pack's search/fetch/research.
 *
 * `fetchBatch` is REAL: it concurrently HTTP-fetches the given URLs, extracts a
 * title + readable text, and truncates to a byte cap — no API key needed.
 *
 * `search` is provider-gated: when a search-provider API key is configured —
 * BYOK secret `web-search` for the tenant, or the host env
 * `OPENWOP_WEBSEARCH_API_KEY` — it queries a real provider (Brave-shaped JSON by
 * default; override the endpoint with `OPENWOP_WEBSEARCH_BASE_URL`). With no key
 * (or on a provider error) it falls back to an HONEST demo result: a real
 * search-engine query URL marked `engine: 'demo'`. `research` composes search →
 * fetchBatch, so it goes live automatically once a key is configured.
 */

import { createLogger } from '../observability/logger.js';
import { resolveSecret } from '../byok/secretResolver.js';
import type { BundleScope } from './inMemorySurfaces.js';

const log = createLogger('host.webResearch');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY = 256 * 1024;

interface Page { url: string; status: number; contentType?: string; title?: string; extractedText?: string; truncated?: boolean; fetchedAt?: string; error?: string }

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1]!.trim().slice(0, 300) : undefined;
}

/** Strip scripts/styles + tags → collapsed readable text. */
function extractReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface WebResearchSurface {
  search(args: { query: string; maxResults?: number; engine?: string; siteFilter?: string }): Promise<{ results: Array<{ url: string; title: string; snippet?: string; rank?: number }>; engine: string; totalResults?: number }>;
  fetchBatch(args: { urls: string[]; concurrency?: number; perRequestTimeoutMs?: number; maxBodyBytes?: number; extractReadable?: boolean }): Promise<{ pages: Page[] }>;
  research(args: { query: string; maxResults?: number; perFetchTimeoutMs?: number; siteFilter?: string }): Promise<{ citations: Array<{ url: string; title: string; snippet?: string; content: string; rank?: number; fetchedAt?: string }>; engine?: string; totalResults?: number }>;
}

type SearchResult = { results: Array<{ url: string; title: string; snippet?: string; rank?: number }>; engine: string; totalResults?: number };

/** Resolve a search-provider key: BYOK secret `web-search` for the tenant first,
 *  then the host env key. Returns null when neither is configured. */
async function resolveSearchKey(tenantId: string): Promise<string | null> {
  try {
    const byok = await resolveSecret('web-search', { tenantId });
    if (byok) return byok;
  } catch {
    // BYOK lookup failures are non-fatal — fall through to the env key.
  }
  return process.env.OPENWOP_WEBSEARCH_API_KEY ?? null;
}

/** Honest demo result — a real query URL, not fabricated content. */
function demoSearch(query: string, maxResults: number): SearchResult {
  return {
    results: [{ url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, title: `Web search: ${query}`, snippet: 'Demo result — configure a search provider (BYOK secret "web-search" or OPENWOP_WEBSEARCH_API_KEY) for live results.', rank: 1 }].slice(0, Math.max(1, maxResults)),
    engine: 'demo',
    totalResults: 1,
  };
}

/** Live provider query (Brave-shaped JSON by default). Throws on transport / non-2xx. */
async function searchLive(query: string, key: string, maxResults: number, siteFilter?: string): Promise<SearchResult> {
  const base = process.env.OPENWOP_WEBSEARCH_BASE_URL ?? 'https://api.search.brave.com/res/v1/web/search';
  const q = siteFilter ? `${query} site:${siteFilter}` : query;
  const url = `${base}?q=${encodeURIComponent(q)}&count=${Math.max(1, Math.min(maxResults, 20))}`;
  const res = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': key }, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`search provider returned HTTP ${res.status}`);
  const body = (await res.json()) as { web?: { results?: Array<{ url?: string; title?: string; description?: string }> } };
  const raw = body.web?.results ?? [];
  const results = raw
    .filter((r): r is { url: string; title?: string; description?: string } => typeof r.url === 'string')
    .slice(0, maxResults)
    .map((r, i) => ({ url: r.url, title: r.title ?? r.url, ...(r.description ? { snippet: r.description } : {}), rank: i + 1 }));
  return { results, engine: process.env.OPENWOP_WEBSEARCH_ENGINE ?? 'brave', totalResults: results.length };
}

export function createWebResearchSurface(scope: BundleScope): WebResearchSurface {
  async function fetchOne(url: string, timeoutMs: number, maxBody: number, readable: boolean): Promise<Page> {
    const fetchedAt = new Date().toISOString();
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const contentType = res.headers.get('content-type') ?? undefined;
      const raw = await res.text();
      const truncated = Buffer.byteLength(raw, 'utf8') > maxBody;
      const body = truncated ? raw.slice(0, maxBody) : raw;
      const page: Page = { url, status: res.status, fetchedAt, ...(contentType ? { contentType } : {}), ...(truncated ? { truncated } : {}) };
      const title = extractTitle(body);
      if (title) page.title = title;
      if (readable) page.extractedText = extractReadableText(body).slice(0, maxBody);
      return page;
    } catch (err) {
      return { url, status: 0, fetchedAt, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const surface: WebResearchSurface = {
    async search({ query, maxResults = 10, siteFilter }) {
      const key = await resolveSearchKey(scope.tenantId);
      if (!key) {
        log.info('web search (demo — no provider key configured)', { query });
        return demoSearch(query, maxResults);
      }
      try {
        const live = await searchLive(query, key, maxResults, siteFilter);
        log.info('web search (live)', { query, engine: live.engine, results: live.results.length });
        return live;
      } catch (err) {
        // Provider error → don't hard-fail the node; fall back to the honest demo.
        log.warn('web search provider failed — falling back to demo result', { query, error: err instanceof Error ? err.message : String(err) });
        return demoSearch(query, maxResults);
      }
    },

    fetchBatch: ({ urls, concurrency = 4, perRequestTimeoutMs = DEFAULT_TIMEOUT_MS, maxBodyBytes = DEFAULT_MAX_BODY, extractReadable = true }) =>
      mapWithConcurrency(urls ?? [], concurrency, (u) => fetchOne(u, perRequestTimeoutMs, maxBodyBytes, extractReadable)).then((pages) => ({ pages })),

    async research({ query, maxResults = 5, perFetchTimeoutMs = DEFAULT_TIMEOUT_MS }) {
      const { results, engine, totalResults } = await surface.search({ query, maxResults });
      const top = results.slice(0, maxResults);
      const { pages } = await surface.fetchBatch({ urls: top.map((r) => r.url), perRequestTimeoutMs: perFetchTimeoutMs, extractReadable: true });
      const citations = top.map((r, i) => {
        const p = pages[i];
        return {
          url: r.url,
          title: p?.title ?? r.title,
          ...(r.snippet ? { snippet: r.snippet } : {}),
          content: p?.extractedText ?? '',
          ...(r.rank !== undefined ? { rank: r.rank } : {}),
          ...(p?.fetchedAt ? { fetchedAt: p.fetchedAt } : {}),
        };
      });
      return { citations, ...(engine ? { engine } : {}), ...(totalResults !== undefined ? { totalResults } : {}) };
    },
  };
  return surface;
}
