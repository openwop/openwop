// Test-only harness to boot the Postgres host with PGlite for
// conformance-suite runs that need a live host. Stays out of the
// shipped surface — used by package.json scripts and ad-hoc dev runs.
process.env.OPENWOP_MEMORY_COMPACTION = process.env.OPENWOP_MEMORY_COMPACTION ?? 'true';
process.env.OPENWOP_TEST_TRIGGER_COMPACTION = process.env.OPENWOP_TEST_TRIGGER_COMPACTION ?? 'true';

const { setQuerier, start } = await import('../src/server.ts');
const { PGlite } = await import('@electric-sql/pglite');

const db = new PGlite('memory://');
setQuerier({
  query: async (sql, params) => {
    const r = await db.query(sql, params || []);
    return { rows: r.rows, rowCount: r.affectedRows };
  },
});
await start();
console.log('host-runner: READY');
