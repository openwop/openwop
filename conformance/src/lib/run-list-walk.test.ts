import { describe, expect, it } from 'vitest';
import { walkRunList, type FetchPage } from './run-list-walk.js';

/** A paginated stub host over `all` (newest first), `size` per page, cursor = next index. */
function stub(all: string[], size: number): { fetch: FetchPage; calls: () => number } {
  let calls = 0;
  const fetch: FetchPage = async (cursor) => {
    calls++;
    const start = cursor === undefined ? 0 : Number(cursor);
    const slice = all.slice(start, start + size);
    const next = start + size < all.length ? String(start + size) : undefined;
    return { page: { runs: slice.map((runId) => ({ runId })), ...(next !== undefined ? { nextCursor: next } : {}) } };
  };
  return { fetch, calls: () => calls };
}

const history = (n: number, tenant = 't1'): string[] => Array.from({ length: n }, (_, i) => `${tenant}/old-${i}`);

describe('walkRunList', () => {
  it('stops after the bounded tail once both fresh ids are seen: it does not walk a long history', async () => {
    const s = stub(['t1/b', 't1/a', ...history(5000)], 100);
    const w = await walkRunList(s.fetch, { want: ['t1/a', 't1/b'], tailPages: 2 });
    expect(w.foundAll).toBe(true);
    expect(s.calls()).toBe(3); // page 1 (found) + 2 tail pages, not 51
    expect(w.pages.length).toBe(3);
  });

  it('finds created runs that land on page 2+ (a host that lists them later still passes)', async () => {
    const s = stub([...history(250), 't1/b', 't1/a', ...history(10, 't1x')], 100);
    const w = await walkRunList(s.fetch, { want: ['t1/a', 't1/b'] });
    expect(w.foundAll).toBe(true);
    expect(w.ids.indexOf('t1/b')).toBeLessThan(w.ids.indexOf('t1/a'));
  });

  it('reports foundAll=false, with the cap as the reason, when a created run is never listed', async () => {
    const s = stub(['t1/b', ...history(400)], 100);
    const w = await walkRunList(s.fetch, { want: ['t1/a', 't1/b'], maxPages: 3 });
    expect(w.foundAll).toBe(false);
    expect(w.reason).toMatch(/did not appear within 3 page/);
  });

  it('returns every id seen, so a foreign-tenant run in the walked pages is visible to the tenant check', async () => {
    const s = stub(['t1/b', 't2/intruder', 't1/a'], 100);
    const w = await walkRunList(s.fetch, { want: ['t1/a', 't1/b'] });
    expect(w.ids).toContain('t2/intruder');
  });

  it('stops at the end of the list without inventing tail pages', async () => {
    const s = stub(['t1/b', 't1/a'], 100);
    const w = await walkRunList(s.fetch, { want: ['t1/a', 't1/b'], tailPages: 3 });
    expect(s.calls()).toBe(1);
    expect(w.foundAll).toBe(true);
  });

  it('surfaces a fetch failure as the reason', async () => {
    const w = await walkRunList(async () => ({ reason: 'GET /runs answered 500' }), { want: ['t1/a'] });
    expect(w.foundAll).toBe(false);
    expect(w.reason).toBe('GET /runs answered 500');
  });
});
