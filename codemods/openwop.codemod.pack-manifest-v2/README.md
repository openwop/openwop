# openwop.codemod.pack-manifest-v2

RFC 0177 rows `C10.1`, `C10.6`, `C10.7`, `C10.8`. Rewrites a registry version manifest (or pack manifest) into the v2 shape: `publicKeyRef → keyId`, `signing.method → signing.scheme: ed25519-canonical-json`, `kind` written when absent, peer-dependency identifiers mapped through the alias table (`host.fs → fs`, `openwop.agents.memoryBackends → agents` + `facets: [memoryBackends]`, …). Refuses when the two key ids disagree, when the signature is over tarball bytes (`ed25519`) or `sigstore`, when `engines.openwop` has no v2-satisfiable explicit range, and when a peer-dependency key resolves to nothing. The output changes signed bytes: the registry re-signs it in `registry/v2/`; the signature is never copied.

Fixtures: `input.json` → `expected.json`; `negative-input.json` (already v2) is unchanged; `refused-input.json` (no ceiling) throws.
