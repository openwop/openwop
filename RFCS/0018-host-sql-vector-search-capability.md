# RFC 0018: host.sql + host.vectorStore + host.searchIndex capabilities

| Field | Value |
|---|---|
| **RFC** | 0018 |
| **Title** | Database adapter capabilities (SQL, vector, search) |
| **Status** | `Draft` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-17 |
| **Updated** | 2026-05-17 |
| **Affects** | `spec/v1/host-capabilities.md` · `schemas/capabilities.schema.json` · `SECURITY/invariants.yaml` |
| **Compatibility** | `additive` |

## Summary

Adds three sibling capabilities: `host.sql` (parametric SQL only), `host.vectorStore` (vector-DB ops), and `host.searchIndex` (full-text). Required by `core.openwop.db` + `core.openwop.rag` packs. SQL injection prevention is enforced at the host (the pack MUST NOT concatenate user input into SQL).

## Motivation

n8n's database family (Postgres / MySQL / MongoDB / ClickHouse / Snowflake / BigQuery / Elasticsearch / Pinecone / Qdrant / Weaviate) is uniformly the same shape — a typed connection identifier + parametric query API. openwop should expose the *shape* as host capabilities, with concrete drivers as vendor packs or host adapters.

The SQL injection invariant is the load-bearing one: every concatenation-style "raw SQL" path eventually shoots itself.

## Proposal

### §A Capability schemas

```json
{
  "sql": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "datasources": { "type": "array", "items": { "type": "object", "additionalProperties": true } },
      "transactions": { "type": "boolean" },
      "drivers": { "type": "array", "items": { "type": "string", "enum": ["postgres","mysql","mariadb","sqlite","mssql","clickhouse","snowflake","bigquery","duckdb"] } }
    },
    "additionalProperties": false
  },
  "nosql": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "datasources": { "type": "array" },
      "drivers": { "type": "array", "items": { "type": "string", "enum": ["mongodb","dynamodb","cosmosdb","firestore"] } }
    },
    "additionalProperties": false
  },
  "vectorStore": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "collections": { "type": "array" },
      "backends": { "type": "array", "items": { "type": "string", "enum": ["pinecone","qdrant","weaviate","milvus","pgvector","redis","mongodb-atlas","chroma","azure-ai-search","in-memory"] } }
    },
    "additionalProperties": false
  },
  "searchIndex": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "indexes": { "type": "array" },
      "backends": { "type": "array", "items": { "type": "string", "enum": ["elasticsearch","opensearch","meilisearch","typesense","algolia"] } }
    },
    "additionalProperties": false
  }
}
```

### §B Host-contract MUSTs

1. **SQL injection invariant**: `ctx.db.sql.query({ sql, params })` MUST treat the `sql` string as a parametric template. Hosts MUST reject calls where `params` is empty and `sql` contains naked literal placeholders that look like user input (`'`, `;`, `--`). Stricter implementations MAY require the SQL parser to confirm parameter binding before execution.
2. Cross-tenant isolation across datasources (mirrors RFC 0015 / 0017 invariants).
3. `transaction` MUST be atomic when `transactions: true` is advertised.

### §C SECURITY invariant

```yaml
- id: sql-parametric-only
  tier: protocol
  summary: "host.sql MUST reject non-parametric queries that inline user input."
  conformance_test: "sql-injection-rejection.test.ts"
```

### §D Conformance

- `sql-injection-rejection.test.ts`: `query({sql: \"SELECT * FROM users WHERE id = '\" + userInput + \"'\", params: []})` rejected.
- `sql-transaction-atomicity.test.ts`: partial failure rolls back.
- `vector-knn-roundtrip.test.ts`: upsert then query returns same vectors.
- `search-bm25-roundtrip.test.ts`.

## Compatibility

**Additive**. All four sub-capabilities optional. Packs refuse registration without advertisement.

## Acceptance criteria

- [ ] Four capability blocks.
- [ ] Prose section per block in `host-capabilities.md`.
- [ ] Invariant `sql-parametric-only`.
- [ ] 4 conformance scenarios.
- [ ] In-memory reference for sql (sqlite) + vector (cosine-similarity in-memory) + search (linear scan).
- [ ] CHANGELOG entry.

## Unresolved questions

1. Should `host.nosql` be a separate RFC? Folded in here because the pack groups them and the contract MUSTs are mostly parallel. **Tentative resolution:** split into 4 sibling RFCs (0018-sql, 0018-nosql, 0018-vector, 0018-search) before promoting any to Active; smaller surfaces unblock independently of one another.
2. SQL injection detection heuristic. The proposed naked-literal regex (`'`, `;`, `--`) is conservative but blunt — it MAY reject legitimate dynamic SQL that quote-escapes correctly. The looser alternative (require explicit `parametric: true` on the call) shifts the burden to callers. Decide before Active.

## Implementation notes (non-normative)

- Schema diffs in §A land in `schemas/capabilities.schema.json` on Active promotion, not at Draft.
- SECURITY invariant `sql-parametric-only` lands in `SECURITY/invariants.yaml` alongside `sql-injection-rejection.test.ts`.
- Reference impl candidates: sqlite for SQL, in-memory cosine-similarity for vector, linear scan for search — all under `examples/hosts/in-memory/`.

## References

- n8n database family (prior art).
- `core.openwop.db` + `core.openwop.rag` packs.
- RFC 0015 host.kvStorage (sibling).
