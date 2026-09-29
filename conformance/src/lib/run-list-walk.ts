/**
 * The `GET /runs` walk the RFC 0182 run-list legs use (`v2-run-list.test.ts`).
 *
 * The list is newest first (`runs.md` §List), so the runs a leg just created
 * sit on the first page. The walk therefore stops once every wanted id has
 * been seen, then follows `nextCursor` for a bounded tail (`tailPages`, or
 * until the list ends) so a host-minted cursor is still exercised. It never
 * walks the whole history: on a long-lived host the conformance tenant holds
 * thousands of runs, and a full walk outran the test timeout (openwop-app,
 * 2026-09-29), failing a leg on the tenant's age rather than the host's
 * behaviour.
 *
 * Pure: the page fetch is injected, so the walk is self-tested without a host.
 */

export type RunListPage = { runs?: unknown; nextCursor?: unknown };

export type FetchPage = (cursor: string | undefined) => Promise<{ page: RunListPage } | { reason: string }>;

export interface WalkResult {
  /** Every runId seen, in list order. */
  readonly ids: string[];
  readonly pages: RunListPage[];
  /** True when every wanted id was seen. */
  readonly foundAll: boolean;
  /** Why the walk stopped early (fetch failure or the page cap), if it did. */
  readonly reason?: string;
}

export interface WalkOptions {
  /** Ids the leg created and expects to find. */
  readonly want: readonly string[];
  /** Pages still followed after every wanted id is seen (default 2). */
  readonly tailPages?: number;
  /** Hard cap on pages fetched while searching (default 50). */
  readonly maxPages?: number;
}

export async function walkRunList(fetchPage: FetchPage, opts: WalkOptions): Promise<WalkResult> {
  const tailPages = opts.tailPages ?? 2;
  const maxPages = opts.maxPages ?? 50;
  const wanted = new Set(opts.want);
  const ids: string[] = [];
  const pages: RunListPage[] = [];
  let cursor: string | undefined;
  let tailLeft: number | undefined; // set once every wanted id is seen
  for (let i = 0; i < maxPages + tailPages; i++) {
    if (tailLeft === undefined && i >= maxPages) {
      return { ids, pages, foundAll: false, reason: `the wanted id(s) did not appear within ${maxPages} page(s)` };
    }
    const got = await fetchPage(cursor);
    if ('reason' in got) return { ids, pages, foundAll: [...wanted].every((w) => ids.includes(w)), reason: got.reason };
    pages.push(got.page);
    for (const r of Array.isArray(got.page.runs) ? got.page.runs : []) {
      const id = (r as { runId?: unknown }).runId;
      if (typeof id === 'string') ids.push(id);
    }
    if (tailLeft === undefined && [...wanted].every((w) => ids.includes(w))) tailLeft = tailPages;
    else if (tailLeft !== undefined) tailLeft -= 1;
    if (typeof got.page.nextCursor !== 'string') break;
    if (tailLeft !== undefined && tailLeft <= 0) break;
    cursor = got.page.nextCursor;
  }
  return { ids, pages, foundAll: [...wanted].every((w) => ids.includes(w)) };
}
