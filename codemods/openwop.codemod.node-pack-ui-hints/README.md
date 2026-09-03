# openwop.codemod.node-pack-ui-hints

RFC 0177 row `C10.2`. In a node-pack manifest, every `x-openwop-form.credentialProvider` ui hint under `nodes[].configSchema` becomes `provider` (the canonical spelling; `node-packs.md` §"Optional sub-fields"). Refuses when both spellings are present and differ. Changes signed bytes; re-sign in `registry/v2/`.

Fixtures: `input.json` → `expected.json`; `negative-input.json` (canonical already) unchanged; `refused-input.json` (disagreeing pair) throws.
