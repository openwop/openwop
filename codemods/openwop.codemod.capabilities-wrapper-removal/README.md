# openwop.codemod.capabilities-wrapper-removal

Removes the deprecated top-level `capabilities` wrapper from a `/.well-known/openwop` document. Register row: `openwop.deprecation.capabilities-wrapper` (RFC 0073; removed at 2.0 by RFC 0167 child C.2).

- **Input**: a discovery document (`schemas/capabilities.schema.json`).
- **Positive**: a wrapper whose every family equals its root twin is deleted.
- **Refusal**: a wrapper that disagrees with the root throws — the codemod never decides which of two shapes is the truth.
- **Negative control**: a document with no wrapper is returned unchanged.
- **Idempotent.**

Run through `scripts/check-codemods.mjs`, which is the only sanctioned runner (it also sabotages its own comparator once per run, per `docs/EVIDENCE-DISCIPLINE.md` §6).
