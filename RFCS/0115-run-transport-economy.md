# RFC 0115: Run Transport Economy

| Field             | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| **RFC**           | 0115                                                                 |
| **Title**         | Run Transport Economy — Conditional GET & Content-Encoding           |
| **Status**        | `Active`                                                             |
| **Author(s)**     | David Tufts (@davidscotttufts)                                       |
| **Created**       | 2026-06-26                                                           |
| **Updated**       | 2026-06-26                                                           |
| **Affects**       | `spec/v1/rest-endpoints.md`, `api/openapi.yaml`, `schemas/capabilities.schema.json`, conformance |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                    |
| **Supersedes**    | —                                                                    |
| **Superseded by** | —                                                                    |

## Summary

`GET /v1/runs/{runId}` returns full run state on every poll with no conditional-request or compression support, while the spec already specifies `ETag` + `If-None-Match` revalidation for `GET /v1/prompts/{templateId}`. This RFC extends the same conditional-GET pattern to run reads and adds `Content-Encoding` negotiation (gzip/zstd), so a client polling an unchanged run pays a `304 Not Modified` instead of re-downloading the snapshot, and a client fetching a large run pays compressed bytes. Both are transparent to clients that don't opt in.

## Motivation

Run state is the most-polled REST resource in the protocol, and clients commonly poll a run that hasn't advanced. Today each poll re-transfers the full snapshot. The conditional-GET machinery already exists in the corpus (prompts endpoint) — this RFC closes an inconsistency rather than inventing a mechanism. Compression negotiation is standard HTTP hygiene that the spec is simply silent on; making it explicit lets conformance verify round-trip integrity.

## Proposal

### Endpoint changes (`rest-endpoints.md`, `GET /v1/runs/{runId}`)

- The server **SHOULD** return a strong `ETag` header on the `200` response. When present, the `ETag` **MUST** be a strong validator derived from the run's latest persisted event-log sequence number (`replay.md` §"durable event log" guarantees every observable transition carries a monotonic sequence), so that it changes on every observable state change and is stable while none occurs. A host **MUST NOT** derive the `ETag` from a coarser signal (e.g., wall-clock or a cached projection) that could leave `304` stale.
- When a request carries `If-None-Match` matching the current `ETag`, the server **MUST** respond `304 Not Modified` with no body.
- The server **MAY** honor `Accept-Encoding: gzip` / `Accept-Encoding: zstd` (already permitted for any JSON response per standard HTTP — see `debug-bundle.md` §compression). When it compresses, it **MUST** set `Content-Encoding` accordingly, **MUST** set `Vary: Accept-Encoding` (mirroring `localized-content.md`), and **MUST NOT** alter the decoded body's bytes or semantics. This RFC adds no new compression mechanics; it makes the negotiation **advertisable** so clients can rely on it.

### OpenAPI diff

```diff
  /v1/runs/{runId}:
    get:
      operationId: getRun
+     parameters:
+       - { name: If-None-Match, in: header, required: false, schema: { type: string } }
      responses:
        '200':
          description: Run state
+         headers:
+           ETag: { schema: { type: string }, description: "RFC 0115. Strong validator over run state version." }
+           Content-Encoding: { schema: { type: string, enum: [gzip, br, zstd] }, required: false }
+       '304':
+         description: "RFC 0115. Not Modified — If-None-Match matched the current ETag."
```

### Capability

A **new top-level** capability `restTransport` (the existing `transport` key in `capabilities.schema.json` is the unrelated file-egress sub-capability `ftp`/`sftp`/`ssh` and is `additionalProperties: false` — it MUST NOT be reused):

```diff
+  "restTransport": {
+    "type": "object",
+    "additionalProperties": false,
+    "description": "RFC 0115. Conditional-GET + Content-Encoding negotiation on run reads. Optional.",
+    "properties": {
+      "conditionalRunGet": { "type": "boolean",
+        "description": "RFC 0115. Host emits a sequence-derived ETag and honors If-None-Match/304 on GET /v1/runs/{runId}." },
+      "contentEncodings": { "type": "array", "items": { "type": "string", "enum": ["gzip", "br", "zstd"] },
+        "description": "RFC 0115. Content-Encoding values the host will negotiate on run reads (gzip baseline; br/zstd optional; advertise only the subset served)." }
+    }
+  }
```

### Examples

**Positive** — `GET /v1/runs/r_9 Accept-Encoding: zstd If-None-Match: "v42"` on an unchanged run → `304 Not Modified` (empty body). After the run advances → `200 OK ETag: "v43" Content-Encoding: zstd`.

**Negative** — a server that returns `304` while the run *has* advanced (stale ETag) → fails the ETag-stability conformance assertion.

## Compatibility

**Additive.** `ETag`/`304`/`Content-Encoding` are transparent to clients that send neither `If-None-Match` nor `Accept-Encoding` — they get today's `200` + identity body. No request or response *contract* changes (the 200 body schema is unchanged); these are HTTP-layer optimizations. `restTransport.conditionalRunGet`/`contentEncodings` are new optional capability fields. Per `COMPATIBILITY.md` §2.1 and §4 ("new normative requirement on previously-undefined behavior"), this is additive.

## Conformance

- **Existing:** `rest-endpoints-*` scenarios cover the `200` run-read shape; prompts scenarios cover ETag/304 there.
- **New:** `run-transport-economy.test.ts`, gated on `capabilityFamily(d,'restTransport')?.conditionalRunGet === true`. Asserts: `ETag` present on `200`; `If-None-Match` with the current ETag → `304` empty body; ETag changes after the run advances and is stable while it doesn't; for each advertised `contentEncodings` value, the compressed body decodes byte-identically to the identity body.

## Alternatives considered

1. **Rely on a reverse proxy for compression/caching.** Rejected: a proxy can gzip the transport but cannot produce a semantically-correct `ETag` from run state — only the host knows the state version, so the conditional GET can only be host-authored.
2. **Add a `?since=<seq>` delta read instead of conditional GET.** Rejected (for this RFC): a since-cursor is a larger surface and overlaps the `updates` event stream (`stream-modes.md`), which already serves incremental consumption. Conditional GET is the minimal poll optimization.
3. **Do nothing.** Rejected: leaves an inconsistency (prompts get conditional GET, runs don't) and a standard, free optimization unspecified.

## Unresolved questions

1. ~~Should `ETag` derivation be normatively pinned?~~ **Resolved (architect review 2026-06-26):** pinned to the run's latest persisted event-log sequence number — see Proposal.
2. ~~Is `zstd` adoption broad enough to recommend, or should the enum start gzip-only with zstd optional?~~ **Resolved (reference-host honesty finding 2026-06-26):** `gzip` is the baseline (current LTS Node ships gzip + Brotli but NOT zstd); `br`/`zstd` are OPTIONAL. The enum lists the permitted values `["gzip","br","zstd"]`; a host advertises only the subset it can actually serve.
3. Should the same conditional-GET treatment extend to other run sub-resources (`/v1/runs/{runId}/artifacts`) in a follow-up?

## Implementation notes (non-normative)

- This is the lowest-risk RFC in the set: pure HTTP-layer, no schema body change, no replay interaction.
- SSE framing economy (the red-team's F7/F8) is **out of scope** — `stream-modes.md` already provides `?bufferMs=` batching for that. This RFC is REST-poll only.

## Acceptance criteria

- [ ] Spec text merged (`rest-endpoints.md` `GET /v1/runs/{runId}` ETag/304/Content-Encoding).
- [ ] `openapi.yaml` updated; `redocly lint` clean.
- [ ] `run-transport-economy.test.ts` in the suite.
- [ ] CHANGELOG entry.
- [ ] Reference host advertises `restTransport.conditionalRunGet` and passes, or impl deferred.

## References

- `spec/v1/rest-endpoints.md` line 39 (`GET /v1/runs/{runId}`), line 249 (prompts ETag/If-None-Match pattern to mirror).
- `spec/v1/stream-modes.md` (`?bufferMs=` batching — why F7/F8 is out of scope).
- RFC 7232 (HTTP conditional requests), RFC 9110 §8.4 (Content-Encoding), RFC 8878 (zstd).
- Sibling RFCs: 0111, 0112, 0113, 0114, 0116.
