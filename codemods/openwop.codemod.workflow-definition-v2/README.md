# openwop.codemod.workflow-definition-v2

RFC 0177 row `C10.3`. Moves the deprecated `config.outputArtifactType` / `config.chatCard` bag entries on a workflow-definition node to the first-class `artifactType` / `chatCard` fields the v1 schema already declares as their replacement. Refuses when the bag entry and the typed field disagree. Applies to exported definitions; a live store reads through the definition adapter.

Fixtures: `input.json` → `expected.json`; `negative-input.json` (typed already) unchanged; `refused-input.json` (disagreeing pair) throws.
