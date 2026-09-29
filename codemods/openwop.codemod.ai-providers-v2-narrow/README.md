# openwop.codemod.ai-providers-v2-narrow

RFC 0169 rows `C2.11` and `C2.12`: v2 narrows `aiProviders.selfHosted`, `realtimeVoice` and `promptPrefixCache` to booleans and `authModes` to one list of modes, and renames `supported` to `providers` (`spec/v2/core/host-services.md` §`aiProviders`). This codemod rewrites the root `aiProviders` record of a v1 discovery document:

- `supported` becomes `providers`, with the same values;
- a non-empty `selfHosted[]` becomes `true`, and an empty one is dropped;
- `realtimeVoice` with both `transcription` and `synthesis` becomes `true`, and one with neither is dropped. `turnDetection` and `bargeIn` have no v2 place;
- `promptPrefixCache` becomes its `supported` value, and `false` is dropped. The `providers` list has no v2 place;
- the per-provider `authModes` map becomes the union of its modes.

It refuses a record carrying both `supported` and `providers` with different values, a `realtimeVoice` with exactly one of `transcription` and `synthesis`, because v2 `true` claims both, and any facet that is neither the v1 nor the v2 shape. Negative control: a record already in the v2 shape is unchanged. Idempotent. Run it after `openwop.codemod.discovery-document-v2` and `openwop.codemod.capabilities-wrapper-removal`.
