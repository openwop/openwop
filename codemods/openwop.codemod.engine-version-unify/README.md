# openwop.codemod.engine-version-unify

RFC 0172 §B axis 3 / migration row `openwop.migration.C5.1`: rewrites every `engineVersion` string that is the decimal rendering of a non-negative integer to that integer, at any depth of a run snapshot, a run event, or an array of either. Integers pass through; any other string is refused. Negative control: a document with integer `engineVersion` (or none) is returned unchanged. Idempotent. Run only through `scripts/check-codemods.mjs`.
