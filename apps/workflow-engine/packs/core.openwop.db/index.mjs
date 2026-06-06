/**
 * core.openwop.db — sql / nosql / search / vector.
 *
 * Each node delegates to ctx.db.<surface>.<method>. Host enforces:
 *  - parametric-only SQL (RFC 0018 §"SQL injection invariant")
 *  - cross-tenant isolation (mirrors agent-memory CTI-1)
 *  - secret resolution (datasource string maps to host-side credentials)
 */

function delegate(surface, method) {
  return async function (ctx) {
    const fn = ctx.db?.[surface]?.[method];
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`host does not implement ctx.db.${surface}.${method}`), { code: 'HOST_CAPABILITY_MISSING' });
    }
    const result = await fn.call(ctx.db[surface], { ...ctx.config, ...ctx.inputs });
    return { status: 'success', outputs: result };
  };
}

export const nodes = {
  'core.db.sql-query':       delegate('sql', 'query'),
  'core.db.sql-execute':     delegate('sql', 'execute'),
  'core.db.sql-transaction': delegate('sql', 'transaction'),
  'core.db.nosql-find':      delegate('nosql', 'find'),
  'core.db.nosql-insert':    delegate('nosql', 'insert'),
  'core.db.nosql-update':    delegate('nosql', 'update'),
  'core.db.nosql-delete':    delegate('nosql', 'delete'),
  'core.db.search-index':    delegate('search', 'index'),
  'core.db.search-query':    delegate('search', 'query'),
  'core.db.vector-upsert':   delegate('vector', 'upsert'),
  'core.db.vector-query':    delegate('vector', 'query'),
  'core.db.vector-delete':   delegate('vector', 'delete'),
};

export default nodes;
