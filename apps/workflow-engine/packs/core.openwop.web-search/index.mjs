/**
 * core.openwop.web-search — spec-canonical web-search pack.
 *
 * One node, `core.web.search`. It is a PROTOCOL-LAYER, capability-advertised
 * node — NOT a host-side `exec` tool. The pack itself makes NO outbound HTTP
 * calls: it asks the host (via `ctx.webSearch(...)`) and the host owns the
 * search-API URL, auth, scraping policy, rate-limit, and cache layer. This
 * mirrors how `core.openwop.ai` asks the host via `ctx.callAI(...)`.
 *
 * Determinism in the demo: hosts that do not advertise the `host.webSearch`
 * surface (the OpenWOP demo backend is one — see
 * apps/workflow-engine/backend/typescript/src/routes/discovery.ts which does
 * NOT advertise host.webSearch) get a DETERMINISTIC FIXTURE result instead of
 * a live search. The fixture is a pure function of the query, so workflow
 * replays and conformance runs stay byte-stable without a real provider. The
 * output is tagged `stub: true` so callers can tell a demo result from a live
 * one. A production host wires a real `ctx.webSearch` and the stub path never
 * runs.
 */

const STUB_ENGINE = 'stub';

/** Deterministic fixture: a pure function of (query, maxResults). No clocks,
 *  no randomness, no network — replay-safe. */
function stubResults(query, maxResults) {
  const n = Math.max(1, Math.min(50, Number(maxResults) || 5));
  const slug = String(query)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'query';
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push({
      url: `https://example.com/${slug}/result-${i + 1}`,
      title: `${query} — reference result ${i + 1}`,
      snippet: `Deterministic demo snippet ${i + 1} for "${query}". The demo backend stubs live web search so replays stay deterministic.`,
      rank: i + 1,
    });
  }
  return results;
}

/**
 * core.web.search — query → ranked results.
 *
 * Delegates to `ctx.webSearch({ query, siteFilter, engine, maxResults })`
 * when the host advertises it; otherwise returns a deterministic fixture.
 */
export async function search(ctx) {
  const config = ctx.config ?? {};
  const inputs = ctx.inputs ?? {};
  const query = inputs.query;
  if (typeof query !== 'string' || query.length === 0) {
    throw Object.assign(new Error('core.web.search requires a non-empty `query` input'), {
      code: 'INVALID_INPUT',
    });
  }
  const maxResults =
    typeof config.maxResults === 'number' && config.maxResults > 0 ? config.maxResults : 5;
  const engine = typeof config.engine === 'string' && config.engine ? config.engine : undefined;

  const host = typeof ctx.webSearch === 'function' ? ctx.webSearch : ctx.aiProviders?.webSearch;
  if (typeof host === 'function') {
    const r = await host.call(ctx, {
      query,
      ...(inputs.siteFilter ? { siteFilter: inputs.siteFilter } : {}),
      ...(engine ? { engine } : {}),
      maxResults,
    });
    // Host returns the canonical output shape; pass through and normalize the
    // required fields so the output always validates against search.output.json.
    return {
      status: 'success',
      outputs: {
        results: Array.isArray(r?.results) ? r.results : [],
        engine: typeof r?.engine === 'string' ? r.engine : engine ?? 'host',
        query,
        ...(typeof r?.totalResults === 'number' ? { totalResults: r.totalResults } : {}),
      },
    };
  }

  // No host surface — deterministic fixture (demo / replay path).
  let results = stubResults(query, maxResults);
  if (Array.isArray(inputs.siteFilter) && inputs.siteFilter.length > 0) {
    const allow = new Set(inputs.siteFilter.map((d) => String(d).toLowerCase()));
    results = results.filter((res) => {
      try {
        return allow.has(new URL(res.url).hostname.toLowerCase());
      } catch {
        return false;
      }
    });
  }
  return {
    status: 'success',
    outputs: {
      results,
      engine: STUB_ENGINE,
      query,
      totalResults: results.length,
      stub: true,
    },
  };
}

export const nodes = {
  'core.web.search': search,
};

export default nodes;
