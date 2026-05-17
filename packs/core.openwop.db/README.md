# core.openwop.db

Database adapter primitives. Capability-gated on `host.sql`, `host.nosql`, `host.vectorStore`, `host.searchIndex` (RFC 0018). The pack speaks no driver — it delegates to the host's adapter surface.

| typeId | host capability | purpose |
|---|---|---|
| `core.db.sql-query` / `sql-execute` / `sql-transaction` | `host.sql` | Parametric-only; host enforces. |
| `core.db.nosql-find` / `nosql-insert` / `nosql-update` / `nosql-delete` | `host.nosql` | MongoDB-shape API. |
| `core.db.search-index` / `search-query` | `host.searchIndex` | Elasticsearch / Meilisearch / Typesense. |
| `core.db.vector-upsert` / `vector-query` / `vector-delete` | `host.vectorStore` | Provider-agnostic. |
