# openwop.codemod.discovery-document-v2

Rewrites a v1 `/.well-known/openwop` document toward the RFC 0169 v2 root: drops dotted `host.*` mirrors that equal their root twin (promotes a dotted-only declared family to its plain key), rewrites the `openwop-core` alias, drops `contractProvenance` and `auth.subjectLinking`, replaces bare `a2a.supported`/`mcp.supported` (drops the family on `false`; needs `protocolVersions[]` beside `true`), rewrites `replay.fork` to `replay.modes`, and moves the eleven extension-class `host.*` families under `extensions.<vendor>.<name>`. Migration rows `openwop.migration.C2.2`–`C2.8`.

Refuses (throws) rather than guesses: a mirror that disagrees with the root, a bare `supported` with no versions, a `fork: true` beside an explicit empty `modes`, or extension families with no `implementation.vendor`. Negative control: a document with none of these shapes is returned unchanged. Idempotent. Run only through `scripts/check-codemods.mjs`.
