# RFC witness bundles (not certification)

Signed conformance bundles cited as the `Active → Accepted` witness for an RFC that
**predates the RFC 0167 certification program** (`scripts/check-accepted-predicate.mjs`
skips RFCs numbered below 0167), where no certified bundle carrying the rows exists.

A bundle here is **not a certification**. It may be `certified: false` for reasons that
have nothing to do with the citing RFC, and the citing RFC's `Updated` field names that
caveat with the bundle's totals. No gate reads this directory as host certification
evidence; certified bundles live only in `evidence/v2-host-bundles/`.

| File | Cited by | Host / tier | Suite | Rows cited | Certified |
|---|---|---|---|---|---|
| `0111-myndhyve-major1-2.42.1.json` | RFC 0111 | MyndHyve `workflow-runtime` (tier-2, steward-affiliated sibling), build `commit:9e5216d4`, revision `workflow-runtime-00788-peh` | `2.42.1`, `--target-major 1` | `context-budget-transcript-bound` (27 assertions), `context-summarization-replay` (15) — both `executed-pass`, no `partial-witness` | no — 1415 / 168 / 190 / 303 / 27; the failing/blocked rows are v1 host-sample seams this host does not mount at major 1 |

Verify: `openwop-conformance --verify <file> --host-key <key>` with the published suite
named in the row, and the key from the host's live `/.well-known/openwop` `signingKeys[]`.
