# Storage

> **Status: Stable.**
> **Normative home:** `fs`, `kvStorage`, `tableStorage`, `sql`, `nosql`, `vectorStore`, `searchIndex`, `blobStorage`, `cache`.

## Why this exists

A node pack keeps files, records and indexes in storage services the host provides, reached through `ctx` ([host-services.md](host-services.md)). Each family below is a contract a host takes on by advertising it.

## Operations

A host advertising a family MUST expose each of its operations to pack code, returning at least the fields shown; it MAY return more. An operation marked † is required only when its facet is `true`: `kvStorage.atomicIncrement`, `kvStorage.compareAndSwap`, `sql.transactions` or `blobStorage.presignSupported`.

- **`fs`** (`ctx.fs`): `read(path) → bytes, contentType?` · `write(path, bytes, contentType?) → path, sizeBytes` · `delete(path) → deleted` · `stat(path) → sizeBytes, modifiedAt, contentType?` · `list(prefix?, cursor?, limit?) → entries[path, sizeBytes], nextCursor?`
- **`kvStorage`** (`ctx.storage.kv`): `get(key) → value?, expiresAt?` · `put(key, value, ttlSeconds?) → ok` · `delete(key) → deleted` · `list(prefix?, cursor?, limit?) → entries[key], nextCursor?` · † `atomicIncrement(key, delta?) → value` · † `compareAndSwap(key, expectedValue, newValue) → swapped`
- **`tableStorage`** (`ctx.storage.table`): `createTable(name, schema) → ok` · `insert(table, row) → rowId` · `get(table, rowId) → row?` · `query(table, filter?, cursor?, limit?) → rows, nextCursor?` · `update(table, rowId, patch) → ok` · `delete(table, rowId) → deleted`
- **`sql`** (`ctx.db.sql`): `query(datasourceId, sql, params) → rows, rowCount` · `execute(datasourceId, sql, params) → rowsAffected` · † `transaction(datasourceId, operations[sql, params]) → committed`
- **`nosql`** (`ctx.db.nosql`): `insert(datasourceId, collection, doc) → id` · `get(…, id) → doc?` · `query(…, filter, cursor?, limit?) → docs, nextCursor?` · `update(…, id, patch) → ok` · `delete(…, id) → deleted`
- **`vectorStore`** (`ctx.db.vector`): `upsert(collection, vectors[id, embedding, metadata?]) → upserted` · `query(collection, embedding, k, filter?) → matches[id, score, metadata?]` · `delete(collection, ids) → deleted`
- **`searchIndex`** (`ctx.db.search`): `index(index, docs[id, fields]) → indexed` · `query(index, q, k?, filter?) → hits[id, score, fields?]` · `delete(index, ids) → deleted`
- **`blobStorage`** (`ctx.storage.blob`): `put(bucket, key, bytes, contentType?) → url, sizeBytes` · `get(bucket, key) → bytes, contentType?` · `delete(bucket, key) → deleted` · `list(bucket, prefix?, cursor?) → entries[key, sizeBytes], nextCursor?` · † `presign(bucket, key, expiresInSeconds, method) → url, expiresAt`
- **`cache`** (`ctx.storage.cache`): `get(key) → value?, expiresAt?` · `put(key, value, ttlSeconds) → ok` · `delete(key) → deleted`

`presign` takes `method` `GET` or `PUT`, and `…` in a `nosql` operation repeats `datasourceId, collection`.

## Shared rules

- **Tenant isolation.** A read for one tenant MUST NOT return data another tenant wrote, even under an identical key or name: `kvStorage` `get` and `list`, `tableStorage` `get` and `query`, `vectorStore` and `searchIndex` `query`, `blobStorage` and `cache` `get`.
- **Datasources.** `sql` and `nosql` datasources are scoped per tenant; access to another tenant's datasource MUST be refused.
- **Backend-invariant.** The operation shapes of `sql` and `nosql` MUST NOT vary with the advertised `drivers`, nor those of `vectorStore` and `searchIndex` with the advertised `backends`. A host MAY back `sql` with any driver it advertises.
- **Size limits.** A key over `kvStorage.maxKeyBytes`, and a write over `fs.maxFileSizeBytes`, `kvStorage.maxValueBytes`, `blobStorage.maxObjectBytes` or `cache.maxValueBytes`, MUST be refused. A `tableStorage` insert MUST be refused once `maxRowsPerTable` is reached.
- **Expiry.** `kvStorage` and `cache` MUST honour an entry's expiry, as a read sees it, with at most one second of drift. `maxTtlSeconds` caps `ttlSeconds` for each.

A family's advertisement also names its targets: `sql.datasources`, `nosql.datasources`, `vectorStore.collections`, `searchIndex.indexes` and `blobStorage.buckets`. `tableStorage` advertises `maxColumnsPerRow`, `indexable` and `fullTextSearch` as limits and features, with no further rule.

A refused call carries `not_found`, `forbidden`, `validation_error`, or `storage_limit_exceeded` for a limit or quota ([errors.md](errors.md) §Host-service refusals). A sandbox escape is `forbidden` with `details.reason: path-outside-sandbox`.

## `fs`

- Every `path` MUST be normalized and resolved relative to `fs.sandboxRoot`.
- A path that escapes the root, whether absolute, through `..` segments or through a symlink, MUST be refused. The host MUST NOT follow such a link partially.
- A permission denial MUST fail the call, never succeed silently or fall through.
- A read of a file over `maxFileSizeBytes` MAY fail rather than stream.
- The `image` (with its `formats`), `pdf` and `transport` (`ftp`, `sftp`, `ssh`) sub-surfaces are optional, and gate the pack delegates that use them.

## `kvStorage`

- When `atomicIncrement` is `true`, increments MUST be atomic across concurrent callers.
- When `compareAndSwap` is `true`, a swap MUST be atomic, with no read-modify-write race. A stale `expectedValue` returns `swapped: false` without mutation.

## `tableStorage`

- Rows MUST conform to the table's declared schema: an insert or update whose column types diverge from it MUST be refused.
- `query` MUST support cursor pagination, and `nextCursor` MUST be opaque and stable across calls.

## `sql` and `nosql`

- `sql` MUST be treated as a parametric template: bound values MUST flow through `params`, never through string interpolation. A pack MUST NOT concatenate user input into `sql`, and a host SHOULD verify parameter binding before execution.
- When `sql.transactions` is `true`, a partial failure inside `transaction` MUST roll back the whole batch, which resolves `committed: false`.
- `nosql` filter operators MUST NOT permit injection. Server-side script evaluation, such as MongoDB `$where`, MUST be refused unless an explicit allowlist is configured.

## `vectorStore` and `searchIndex`

- `vectorStore`: an `upsert` followed by a `query` with the same embedding MUST return the inserted ids in the top `k` matches when `k` is at least the number inserted.
- `searchIndex`: an `index` followed by a `query` with a substring of an indexed field MUST return the indexed id with `score` above 0.

## `blobStorage`

Presigned URLs MUST expire at the advertised TTL. A presigned request after expiry MUST fail at the storage layer, not after an authorization skip.

*Sources: RFCs 0014, 0015, 0016, 0018, 0019, 0228.*
