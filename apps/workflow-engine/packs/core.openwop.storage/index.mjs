/**
 * core.openwop.storage — kv / table / cache / blob / queue.
 *
 * Each node delegates to ctx.storage.<surface> if the host advertises it
 * (host.kvStorage / host.tableStorage / host.cache / host.blobStorage /
 * host.queue per RFCs 0015–0019). When the surface is missing the node
 * throws HOST_CAPABILITY_MISSING so registration-time peerDependency
 * resolution catches it.
 */

function delegate(surface, method) {
  return async function (ctx) {
    const fn = ctx.storage?.[surface]?.[method];
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`host does not implement ctx.storage.${surface}.${method}`), { code: 'HOST_CAPABILITY_MISSING' });
    }
    const result = await fn.call(ctx.storage[surface], { ...ctx.config, ...ctx.inputs });
    return { status: 'success', outputs: result };
  };
}

export const nodes = {
  // kv
  'core.storage.kv-get':                delegate('kv', 'get'),
  'core.storage.kv-set':                delegate('kv', 'set'),
  'core.storage.kv-delete':             delegate('kv', 'delete'),
  'core.storage.kv-list':               delegate('kv', 'list'),
  'core.storage.kv-atomic-increment':   delegate('kv', 'atomicIncrement'),
  'core.storage.kv-cas':                delegate('kv', 'cas'),
  // table
  'core.storage.table-insert':          delegate('table', 'insert'),
  'core.storage.table-update':          delegate('table', 'update'),
  'core.storage.table-upsert':          delegate('table', 'upsert'),
  'core.storage.table-delete':          delegate('table', 'delete'),
  'core.storage.table-query':           delegate('table', 'query'),
  'core.storage.table-count':           delegate('table', 'count'),
  // cache
  'core.storage.cache-get':             delegate('cache', 'get'),
  'core.storage.cache-put':             delegate('cache', 'put'),
  'core.storage.cache-evict':           delegate('cache', 'evict'),
  // blob
  'core.storage.blob-put':              delegate('blob', 'put'),
  'core.storage.blob-get':              delegate('blob', 'get'),
  'core.storage.blob-presign':          delegate('blob', 'presign'),
  // queue
  'core.storage.queue-enqueue':         delegate('queue', 'enqueue'),
  'core.storage.queue-dequeue':         delegate('queue', 'dequeue'),
};

export default nodes;
