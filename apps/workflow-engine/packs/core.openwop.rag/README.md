# core.openwop.rag

Retrieval-Augmented-Generation primitives. Composes with `core.openwop.ai` (embeddings), `core.openwop.db` (vector ops), and `core.openwop.http` (loaders).

| typeId | purpose |
|---|---|
| `core.rag.loader-url` / `loader-file` / `loader-github` / `loader-s3` | Pull source docs from various locations. |
| `core.rag.splitter-recursive` / `splitter-character` / `splitter-token` | Chunk docs for embedding. |
| `core.rag.vector-upsert` / `vector-query` / `vector-delete` | Vector-store thin wrappers (delegate to `core.openwop.db.vector-*`). |
| `core.rag.retriever-basic` / `retriever-multi-query` / `retriever-contextual-compression` | Retrieval strategies. |
