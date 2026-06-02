/**
 * `ctx.webResearch` host surface (`host.webResearch`,
 * `spec/v1/host-capabilities.md` §host.webResearch) — the
 * `vendor.myndhyve.web-research` pack's search/fetch/research.
 *
 * `fetchBatch` is REAL: it concurrently HTTP-fetches the given URLs, extracts a
 * title + readable text, and truncates to a byte cap — no API key needed.
 *
 * `search` requires a search provider. The sample host ships none, so it
 * returns an HONEST demo result: a real search-engine query URL for the term
 * (a usable link, not fabricated content), marked `engine: 'demo'`. Configure a
 * BYOK provider for live results. `research` composes search → fetchBatch.
 */

import { createLogger } from '../observability/logger.js';
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

export function createWebResearchSurface(_scope: BundleScope): WebResearchSurface {
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
    async search({ query, maxResults = 10, engine }) {
      // No search provider on the sample host → honest demo result: a real
      // query URL the user can click, not fabricated page content.
      const q = encodeURIComponent(query);
      log.info('web search (demo — no provider configured)', { query, engine });
      return {
        results: [{ url: `https://duckduckgo.com/?q=${q}`, title: `Web search: ${query}`, snippet: 'Demo result — configure a search provider (BYOK) for live results.', rank: 1 }].slice(0, Math.max(1, maxResults)),
        engine: 'demo',
        totalResults: 1,
      };
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
