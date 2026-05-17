# core.openwop.storage

State primitives. Capability-gated on `host.kvStorage`, `host.tableStorage`, `host.cache`, `host.blobStorage`, `host.queue` — each node gated on its specific block (RFCs 0015, 0016, 0017, 0019).

| typeId | host capability | purpose |
|---|---|---|
| `core.storage.kv-get` / `kv-set` / `kv-delete` / `kv-list` | `host.kvStorage` | TTL-aware key-value store. |
| `core.storage.kv-atomic-increment` / `kv-cas` | `host.kvStorage` | Counter + dedupe primitives. |
| `core.storage.table-insert` / `table-update` / `table-upsert` / `table-delete` / `table-query` / `table-count` | `host.tableStorage` | Structured records (Make Data Store equivalent). |
| `core.storage.cache-get` / `cache-put` / `cache-evict` | `host.cache` | TTL cache for HTTP/AI responses. |
| `core.storage.blob-put` / `blob-get` / `blob-presign` | `host.blobStorage` | Binary artifact store. |
| `core.storage.queue-enqueue` / `queue-dequeue` | `host.queue` | In-engine work queue. |

All side-effectful; cacheable for the read-paths.
